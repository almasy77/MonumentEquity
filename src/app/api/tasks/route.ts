import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import type { Task } from "@/lib/validations";

// GET /api/tasks?deal_id=xxx — list tasks (optionally filtered by deal)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dealId = req.nextUrl.searchParams.get("deal_id");
    const redis = getRedis();

    let ids: string[];
    if (dealId) {
      ids = await redis.zrange(`tasks:by_deal:${dealId}`, 0, -1, { rev: true });
    } else {
      ids = await redis.zrange("tasks:all", 0, -1, { rev: true });
    }

    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`task:${id}`);
    }
    const results = await pipeline.exec<(Task | null)[]>();
    return NextResponse.json(results.filter((r): r is Task => r !== null));
  } catch (err) {
    console.error("GET /api/tasks error:", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

// POST /api/tasks — create a task
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.deal_id || !body.title || !body.due_date) {
      return NextResponse.json(
        { error: "deal_id, title, and due_date are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const task: Task = {
      id,
      deal_id: body.deal_id,
      title: body.title,
      description: body.description || undefined,
      due_date: body.due_date,
      completed: false,
      stage: body.stage || undefined,
      priority: body.priority || "medium",
      created_by: session.user.id,
      created_at: now,
    };

    const redis = getRedis();
    const dueTimestamp = new Date(body.due_date).getTime();

    await redis.set(`task:${id}`, JSON.stringify(task));
    await addToIndex("tasks:all", id, dueTimestamp);
    await addToIndex(`tasks:by_deal:${body.deal_id}`, id, dueTimestamp);

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("POST /api/tasks error:", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
