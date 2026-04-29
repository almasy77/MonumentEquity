import { upload } from "@vercel/blob/client";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4MB — stay under Vercel's 4.5MB serverless body limit

export async function uploadFile(
  file: File,
  endpoint: string,
  extraFields?: Record<string, string>,
): Promise<Response> {
  if (file.size <= DIRECT_UPLOAD_LIMIT) {
    const formData = new FormData();
    formData.append("file", file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        formData.append(key, value);
      }
    }
    return fetch(endpoint, { method: "POST", body: formData });
  }

  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
  });

  const formData = new FormData();
  formData.append("blobUrl", blob.url);
  formData.append("fileName", file.name);
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      formData.append(key, value);
    }
  }
  return fetch(endpoint, { method: "POST", body: formData });
}
