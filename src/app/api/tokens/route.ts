import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { createApiToken, listApiTokens, type TokenStore } from "@/lib/api-tokens";

// Token management is session-only and admin-only: a token can never mint tokens.

// GET /api/tokens — list API tokens (never returns the raw token)
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const tokens = await listApiTokens(getRedis() as unknown as TokenStore);
  return NextResponse.json(tokens);
}

// POST /api/tokens { name } — create a token; the raw value is returned once
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const name = typeof bodyOrError.name === "string" ? bodyOrError.name.trim() : "";
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "name is required (max 60 characters)" }, { status: 400 });
  }
  const { raw, record } = await createApiToken(getRedis() as unknown as TokenStore, { name, userId: session.user.id });
  return NextResponse.json({ token: raw, record }, { status: 201 });
}
