import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import type { RentComp } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();
  const comp = await redis.get<RentComp>(`rent_comp:${id}`);
  if (!comp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(comp);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();
  const comp = await redis.get<RentComp>(`rent_comp:${id}`);
  if (!comp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await redis.del(`rent_comp:${id}`);
  await removeFromIndex("rent_comps:all", id);
  if (comp.submarket) {
    await removeFromIndex(`rent_comps:by_submarket:${comp.submarket.toLowerCase()}`, id);
  }

  return NextResponse.json({ success: true });
}
