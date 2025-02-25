import {
  Static,
  Type,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { COLLECTION_NAME, getEmbedder, qdrant } from "../shared";

// Define schemas for request validation
const EmbedSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Number()]),
  text: Type.String(),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

type EmbedRequest = Static<typeof EmbedSchema>;

export const embed = (fastify: FastifyInstance) =>
  fastify.withTypeProvider<TypeBoxTypeProvider>().post<{
    Body: EmbedRequest;
  }>("/embed", { schema: { body: EmbedSchema } }, async (request, reply) => {
    try {
      const { id, text, metadata = {} } = request.body;
      const embedder = await getEmbedder();

      // Generate the embedding
      const embedding = await embedder(text, {
        pooling: "mean",
        normalize: true,
      });

      // Check if the ID already exists in Qdrant
      const existing = await qdrant.getCollection(COLLECTION_NAME).then(
        async () => {
          try {
            const result = await qdrant.retrieve(COLLECTION_NAME, {
              ids: [id],
            });
            return result.length > 0;
          } catch {
            return false;
          }
        },
        () => false,
      );

      if (existing) {
        // Delete the old embedding before inserting the new one
        await qdrant.delete(COLLECTION_NAME, { points: [id] });
      }

      // Insert new embedding
      await qdrant.upsert(COLLECTION_NAME, {
        points: [
          {
            id,
            vector: Array.from(embedding.data),
            payload: {
              text,
              ...metadata,
            },
          },
        ],
      });

      return reply.send({
        success: true,
        message: existing
          ? "Embedding updated in Qdrant"
          : "New embedding inserted",
      });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ error: "Failed to process embedding", raw: error });
    }
  });
