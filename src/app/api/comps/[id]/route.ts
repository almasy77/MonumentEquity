import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import type { MarketComp } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();
  const comp = await redis.get<MarketComp>(`comp:${id}`);
  if (!comp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(comp);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();
  const comp = await redis.get<MarketComp>(`comp:${id}`);
  if (!comp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await redis.del(`comp:${id}`);
  await removeFromIndex("comps:all", id);
  await removeFromIndex(`comps:by_market:${comp.city.toLowerCase()}`, id);

  return NextResponse.json({ success: true });
}
