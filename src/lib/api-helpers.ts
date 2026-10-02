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

// P3-11: widen a comp search beyond the exact city. The comp records carry no county
// or lat/lng, so a true radius is not possible; the available proxies are the exact
// city, a shared 3-digit ZIP prefix (a tighter, more comparable area than a whole
// state), and the same state. Each returned comp is labeled with WHY it matched so the
// user can weight a far comp accordingly.
export type CompMatchReason = "city" | "zip3" | "state";

function normCity(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** First 3 digits of a ZIP (ignoring non-digits); "" when fewer than 3 are present. */
function zip3(s: string | undefined): string {
  const digits = (s ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : "";
}

/**
 * Classify how a comp matches a subject location, or null when it does not match any
 * tier. Exact city wins; otherwise a shared 3-digit ZIP prefix; otherwise the same
 * state. zip3 ranks ahead of state because a shared ZIP prefix is a smaller area.
 */
export function compMatchReason(
  comp: { city?: string; state?: string; zip?: string },
  subject: { city?: string; state?: string; zip?: string },
): CompMatchReason | null {
  if (subject.city && comp.city && normCity(comp.city) === normCity(subject.city)) return "city";
  const sz = zip3(subject.zip);
  if (sz && zip3(comp.zip) === sz) return "zip3";
  if (subject.state && comp.state && comp.state.trim().toUpperCase() === subject.state.trim().toUpperCase()) return "state";
  return null;
}

/** Sort rank for a match tier (lower = closer / shown first). */
export function compMatchRank(reason: CompMatchReason): number {
  return reason === "city" ? 0 : reason === "zip3" ? 1 : 2;
}
