import { del, put } from "@vercel/blob";
import type { DealFile } from "@/lib/validations";

// Uploads land in the Vercel Blob store; only fetch from that host (block SSRF
// to internal/arbitrary URLs), and never buffer more than the upload cap.
const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function fetchBlobFile(
  blobUrl: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<{ buffer: ArrayBuffer; cleanup: () => Promise<void> }> {
  let url: URL;
  try {
    url = new URL(blobUrl);
  } catch {
    throw new Error("Invalid file URL");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    throw new Error("File URL must be a Vercel Blob URL");
  }

  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error("Failed to fetch uploaded file");
  }
  // Reject oversized bodies up front (declared length) and after buffering
  // (guards a lying/absent content-length).
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error("File too large. Maximum 25MB.");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error("File too large. Maximum 25MB.");
  }
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

// Persist a source document to Vercel Blob under a deal-scoped path and return a
// DealFile record to store on the deal. Used so imported OM / rent roll / T12
// files (and manual uploads) are kept rather than parse-and-discarded.
export async function persistDealFile(
  buffer: ArrayBuffer,
  fileName: string,
  kind: DealFile["kind"],
  contentType?: string,
  uploadedBy?: string,
): Promise<DealFile> {
  const id = crypto.randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
  const blob = await put(`deal-files/${id}-${safeName}`, Buffer.from(buffer), {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return {
    id,
    name: fileName,
    kind,
    url: blob.url,
    size: buffer.byteLength,
    content_type: contentType,
    uploaded_at: new Date().toISOString(),
    uploaded_by: uploadedBy,
  };
}

// Best-effort content-type from a filename extension (for Blob downloads).
export function guessContentType(fileName: string): string | undefined {
  const n = fileName.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

// Best-effort delete of a persisted deal file's blob.
export async function deleteBlobUrl(url: string): Promise<void> {
  try {
    await del(url);
  } catch {
    // Best-effort
  }
}
