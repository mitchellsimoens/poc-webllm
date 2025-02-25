import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { COLLECTION_NAME, qdrant } from "../shared";

export const listEmbeds = (fastify: FastifyInstance) =>
  fastify.withTypeProvider<TypeBoxTypeProvider>().get<{
    Querystring: { limit?: number; offset?: number };
  }>("/list", async (request, reply) => {
    try {
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const offset = request.query.offset ? Number(request.query.offset) : 0;

      const results = await qdrant.scroll(COLLECTION_NAME, {
        with_payload: true, // ✅ Include metadata and text
        with_vector: false, // ❌ Exclude vectors (to reduce response size)
        limit, // ✅ Number of results per page
        offset, // ✅ Pagination offset
      });

      return reply.send({
        total: results.points.length,
        embeddings: results.points,
        next_offset: results.next_page_offset,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ error: "Failed to list stored embeddings", raw: error });
    }
  });
