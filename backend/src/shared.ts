import { QdrantClient } from "@qdrant/js-client-rest";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

export const qdrant = new QdrantClient({ url: "http://localhost:6333" });
export const COLLECTION_NAME = "documents";

let embedder: FeatureExtractionPipeline;
export const getEmbedder = async () => {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }

  return embedder;
};
