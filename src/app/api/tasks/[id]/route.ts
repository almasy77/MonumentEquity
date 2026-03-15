import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import type { Task } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/tasks/[id]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();
  const task = await redis.get<Task>(`task:${id}`);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(task);
}

// PUT /api/tasks/[id] — update task (toggle complete, edit fields)
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json();
  const redis = getRedis();

  const existing = await redis.get<Task>(`task:${id}`);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated: Task = {
    ...existing,
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    due_date: body.due_date ?? existing.due_date,
    priority: body.priority ?? existing.priority,
    completed: body.completed ?? existing.completed,
    completed_at:
      body.completed && !existing.completed
        ? new Date().toISOString()
        : body.completed === false
          ? undefined
          : existing.completed_at,
  };

  await redis.set(`task:${id}`, JSON.stringify(updated));

  return NextResponse.json(updated);
}

// DELETE /api/tasks/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const redis = getRedis();

  const task = await redis.get<Task>(`task:${id}`);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await redis.del(`task:${id}`);
  await removeFromIndex("tasks:all", id);
  await removeFromIndex(`tasks:by_deal:${task.deal_id}`, id);

  return NextResponse.json({ success: true });
}
