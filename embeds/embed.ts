import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { v5 as uuidv5 } from "uuid";

const DIRECTORY_PATH = "./files";
const EMBED_URL = "http://localhost:3000/embed";

// UUID Namespace for consistent hashing
const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // Random UUID namespace

async function hashFilenameToUUID(filename: string): Promise<string> {
  return uuidv5(filename, UUID_NAMESPACE);
}

async function parseFile(
  filePath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ metadata: Record<string, any>; text: string }> {
  const content = await readFile(filePath, "utf-8");

  const metaMatch = content.match(/^([\s\S]*?)\n---\n([\s\S]*)$/);
  if (metaMatch) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {};
    const metaLines = metaMatch[1].split("\n").filter((line) => line.trim());

    for (const line of metaLines) {
      const [key, value] = line.split(":").map((s) => s.trim());
      if (key && value !== undefined) {
        metadata[key] = value;
      }
    }

    return { metadata, text: metaMatch[2].trim() };
  }

  return { metadata: {}, text: content.trim() };
}

async function sendToEmbed(filePath: string) {
  const filename = filePath.split("/").pop()!;
  const id = await hashFilenameToUUID(filename);

  const { metadata, text } = await parseFile(filePath);

  const payload = {
    id,
    text,
    metadata,
  };

  console.log(`📤 Sending: ${filename} (ID: ${id})`);

  try {
    const response = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    console.log(`✅ Response:`, result);
  } catch (error) {
    console.error(`❌ Failed to embed ${filename}:`, error);
  }
}

async function processFiles() {
  try {
    const files = await readdir(DIRECTORY_PATH);

    for (const file of files) {
      const filePath = join(DIRECTORY_PATH, file);
      await sendToEmbed(filePath);
    }

    console.log("🎉 All files processed.");
  } catch (error) {
    console.error("❌ Error reading directory:", error);
  }
}

await processFiles();
