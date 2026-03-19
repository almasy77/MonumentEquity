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

  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const task = await redis.get<Task>(`task:${id}`);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(task);
  } catch (err) {
    console.error("GET /api/tasks/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

// PUT /api/tasks/[id] — update task (toggle complete, edit fields)
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
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
  } catch (err) {
    console.error("PUT /api/tasks/[id] error:", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] (admin only)
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const redis = getRedis();

    const task = await redis.get<Task>(`task:${id}`);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await redis.del(`task:${id}`);
    await removeFromIndex("tasks:all", id);
    await removeFromIndex(`tasks:by_deal:${task.deal_id}`, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/tasks/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
