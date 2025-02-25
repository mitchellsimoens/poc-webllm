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
const COLLECTION_NAME = "documents";

let embedder: FeatureExtractionPipeline;

// Ensure Qdrant collection exists
async function ensureCollection() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(
      (col) => col.name === COLLECTION_NAME,
    );

    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: { size: 384, distance: "Cosine" }, // Adjust size based on embedding model
      });
      console.log(`✅ Collection '${COLLECTION_NAME}' created.`);
    } else {
      console.log(`✅ Collection '${COLLECTION_NAME}' already exists.`);
    }
  } catch (error) {
    console.error("❌ Failed to check or create collection:", error);
    process.exit(1);
  }
}

// Load the embedding model on startup
async function loadEmbedder() {
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
}

// Ensure the collection and embedding model are ready before starting
await ensureCollection();
await loadEmbedder();

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
    const existing = await qdrant.getCollection(COLLECTION_NAME).then(
      async () => {
        try {
          const result = await qdrant.retrieve(COLLECTION_NAME, { ids: [id] });
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
    return reply
      .status(500)
      .send({ error: "Failed to process embedding", raw: error });
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
    const results = await qdrant.search(COLLECTION_NAME, {
      vector: Array.from(queryEmbedding.data),
      limit: top_k,
      with_payload: true,
    });

    return reply.send({ results });
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: "Retrieval failed", raw: error });
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
