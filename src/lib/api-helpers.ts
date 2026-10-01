import { NextRequest, NextResponse } from "next/server";

/**
 * Safely parse JSON from a request body.
 * Returns the parsed body or a 400 error response.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeJson<T = Record<string, any>>(
  req: NextRequest
): Promise<T | NextResponse> {
  try {
    return (await req.json()) as T;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }
}

/**
 * Type guard: returns true if the value is a NextResponse (error).
 */
export function isErrorResponse(
  value: unknown
): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Sanitize a string for use in a Redis key.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
export function sanitizeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

/**
 * Redis index key for a comp's market (city). Read and write MUST use this one
 * helper. Previously the write path used the raw lowercased city while the read
 * path ran it through sanitizeKeySegment, which strips spaces — so a multi-word
 * city ("West View") was WRITTEN under "west view" but READ under "westview" and
 * returned nothing. Single-word cities happened to match. Normalize to trimmed,
 * lowercased, single-spaced so both paths agree and existing data is found.
 */
export function compMarketKey(city: string): string {
  return `comps:by_market:${city.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
