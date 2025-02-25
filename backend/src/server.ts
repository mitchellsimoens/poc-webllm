import Fastify from "fastify";
import {
  Type,
  Static,
  TypeBoxValidatorCompiler,
  TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import { FeatureExtractionPipeline, pipeline } from "@xenova/transformers";
import { QdrantClient } from "@qdrant/js-client-rest";

const fastify = Fastify({ logger: true }).setValidatorCompiler(
  TypeBoxValidatorCompiler,
);

const qdrant = new QdrantClient({ url: "http://localhost:6333" });

let embedder: FeatureExtractionPipeline;

// Load the embedding model on startup
async function loadEmbedder() {
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
}
loadEmbedder();

// Define schemas for request validation
const EmbedSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Number()]),
  text: Type.String(),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

type EmbedRequest = Static<typeof EmbedSchema>;

const RetrieveSchema = Type.Object({
  q: Type.String(),
  top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

type RetrieveRequest = Static<typeof RetrieveSchema>;

// **POST /embed** - Insert or update an embedding in Qdrant
fastify.withTypeProvider<TypeBoxTypeProvider>().post<{
  Body: EmbedRequest;
}>("/embed", { schema: { body: EmbedSchema } }, async (request, reply) => {
  try {
    const { id, text, metadata = {} } = request.body;

    // Generate the embedding
    const embedding = await embedder(text, {
      pooling: "mean",
      normalize: true,
    });

    // Check if the ID already exists in Qdrant
    const existing = await qdrant.getCollection("documents").then(
      async () => {
        try {
          const result = await qdrant.retrieve("documents", { ids: [id] });
          return result.length > 0;
        } catch {
          return false;
        }
      },
      () => false,
    );

    if (existing) {
      // Delete the old embedding before inserting the new one
      await qdrant.delete("documents", { points: [id] });
    }

    // Insert new embedding
    await qdrant.upsert("documents", {
      points: [{ id, vector: Array.from(embedding.data), payload: metadata }],
    });

    return reply.send({
      success: true,
      message: existing
        ? "Embedding updated in Qdrant"
        : "New embedding inserted",
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: "Failed to process embedding" });
  }
});

// **GET /retrieve** - Search for similar documents
fastify.withTypeProvider<TypeBoxTypeProvider>().get<{
  Querystring: RetrieveRequest;
}>("/retrieve", { schema: { querystring: RetrieveSchema } }, async (request, reply) => {
  try {
    const { q, top_k = 5 } = request.query;

    // Generate query embedding
    const queryEmbedding = await embedder(q, {
      pooling: "mean",
      normalize: true,
    });

    // Search in Qdrant
    const results = await qdrant.search("documents", {
      vector: Array.from(queryEmbedding.data),
      limit: top_k,
      with_payload: true,
    });

    return reply.send({ results });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: "Retrieval failed" });
  }
});

// Start Fastify server
fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server running at ${address}`);
});
