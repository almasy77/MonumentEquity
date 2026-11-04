import { NextResponse } from "next/server";
import { CORS_HEADERS } from "./oauth-config";

/** JSON response that is never cached (tokens, metadata) with open CORS (no credentials are used). */
export function json(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...CORS_HEADERS, ...extra },
  });
}

export function oauthError(error: string, description: string, status = 400): NextResponse {
  return json({ error, error_description: description }, status);
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Parse an application/x-www-form-urlencoded (or JSON) OAuth request body into a flat string map. */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [key, v] of Object.entries(body)) if (typeof v === "string") out[key] = v;
  } else {
    const form = await req.formData().catch(() => null);
    if (form) for (const [key, v] of form.entries()) if (typeof v === "string") out[key] = v;
  }
  return out;
}
