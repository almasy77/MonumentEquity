import { del } from "@vercel/blob";

export async function fetchBlobFile(
  blobUrl: string,
): Promise<{ buffer: ArrayBuffer; cleanup: () => Promise<void> }> {
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error("Failed to fetch uploaded file");
  }
  const buffer = await response.arrayBuffer();
  return {
    buffer,
    cleanup: async () => {
      try {
        await del(blobUrl);
      } catch {
        // Best-effort cleanup
      }
    },
  };
}
