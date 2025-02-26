import {
  Static,
  Type,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { COLLECTION_NAME, getEmbedder, qdrant } from "../shared";

const RetrieveSchema = Type.Object({
  q: Type.String(),
  top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

type RetrieveRequest = Static<typeof RetrieveSchema>;

const SCORE_THRESHOLD = 0.2;

export const retrieveEmbeds = (fastify: FastifyInstance) =>
  fastify.withTypeProvider<TypeBoxTypeProvider>().get<{
    Querystring: RetrieveRequest;
  }>("/retrieve", { schema: { querystring: RetrieveSchema } }, async (request, reply) => {
    try {
      const { q, top_k = 20 } = request.query;
      const embedder = await getEmbedder();

      // Generate query embedding
      const queryEmbedding = await embedder(q, {
        pooling: "mean",
        normalize: true,
      });

      // Search in Qdrant
      const results = await qdrant.search(COLLECTION_NAME, {
        vector: Array.from(queryEmbedding.data),
        limit: top_k,
        with_payload: true,
        score_threshold: SCORE_THRESHOLD,
      });

      return reply.send({ results });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Retrieval failed", raw: error });
    }
  });
