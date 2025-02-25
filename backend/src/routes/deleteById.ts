import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { COLLECTION_NAME, qdrant } from "../shared";

export const deleteById = (fastify: FastifyInstance) =>
  fastify.withTypeProvider<TypeBoxTypeProvider>().delete<{
    Params: { id: string };
  }>("/embed/:id", async (request, reply) => {
    try {
      const { id } = request.params;

      // Attempt to delete the embedding
      await qdrant.delete(COLLECTION_NAME, { points: [id] });

      return reply.send({
        success: true,
        message: `Embedding with ID ${id} removed from Qdrant`,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ error: "Failed to remove embedding", raw: error });
    }
  });
