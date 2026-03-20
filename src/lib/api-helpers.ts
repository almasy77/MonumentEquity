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
