import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { COLLECTION_NAME, qdrant } from "../shared";

export const deleteAll = (fastify: FastifyInstance) =>
  fastify
    .withTypeProvider<TypeBoxTypeProvider>()
    .delete("/embed/all", async (_request, reply) => {
      try {
        await qdrant.delete(COLLECTION_NAME, { filter: {} }); // Deletes all points in the collection

        return reply.send({
          success: true,
          message: "All embeddings removed from Qdrant",
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Failed to remove all embeddings" });
      }
    });
