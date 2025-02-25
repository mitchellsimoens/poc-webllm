import cors from "@fastify/cors";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { deleteAll } from "./routes/deleteAll";
import { deleteById } from "./routes/deleteById";
import { embed } from "./routes/embed";
import { listEmbeds } from "./routes/list";
import { retrieveEmbeds } from "./routes/retrieve";
import { COLLECTION_NAME, qdrant } from "./shared";

const fastify = Fastify({
  logger:
    process.env.NODE_ENV === "production"
      ? true
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true, // Enable colors
              translateTime: "yyyy-mm-dd HH:MM:ss", // Readable timestamps
              ignore: "pid,hostname", // Hide unnecessary fields
            },
          },
        },
}).setValidatorCompiler(TypeBoxValidatorCompiler);

// Enable CORS
await fastify.register(cors, {
  origin: "http://localhost:8883", // Allow frontend access
  methods: ["GET", "POST", "DELETE"], // Allowed HTTP methods
});

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

// Ensure the collection and embedding model are ready before starting
await ensureCollection();

// **POST /embed** - Insert or update an embedding in Qdrant
fastify.register(embed);

// **DELETE /embed/all** - Remove all embeddings from Qdrant
fastify.register(deleteAll);

// **DELETE /embed/:id** - Remove an embedding from Qdrant
fastify.register(deleteById);

// **GET /retrieve** - Search for similar documents
fastify.register(retrieveEmbeds);

// **GET /list** - List stored embeddings with pagination
fastify.register(listEmbeds);

// Start Fastify server
fastify.listen({ port: 3000 }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
