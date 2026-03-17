import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/db";
import { DEAL_STAGES, STAGE_STALE_DAYS } from "@/lib/constants";
import type { Deal, Task } from "@/lib/validations";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * GET /api/cron/reminders
 * Called daily by QStash. Scans for stale deals and overdue tasks.
 * Returns a summary for logging/monitoring.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const redis = getRedis();
    const now = Date.now();
    const today = new Date().toISOString().split("T")[0];

    // 1. Find stale deals
    const staleDeals: { id: string; address: string; stage: string; daysSinceActivity: number }[] = [];

    for (const stage of DEAL_STAGES) {
      const ids = await redis.zrange(`deals:by_stage:${stage}`, 0, -1);
      if (ids.length === 0) continue;

      const staleDays = STAGE_STALE_DAYS[stage];
      const staleThreshold = now - staleDays * 86400000;

      const pipeline = redis.pipeline();
      for (const id of ids) {
        pipeline.get(`deal:${id}`);
      }
      const deals = await pipeline.exec<(Deal | null)[]>();

      for (const deal of deals) {
        if (!deal || deal.status !== "active") continue;
        const lastActivity = new Date(deal.last_activity_at || deal.updated_at).getTime();
        if (lastActivity < staleThreshold) {
          staleDeals.push({
            id: deal.id,
            address: deal.address,
            stage: deal.stage,
            daysSinceActivity: Math.floor((now - lastActivity) / 86400000),
          });
        }
      }
    }

    // 2. Find overdue tasks
    const taskIds = await redis.zrange("tasks:all", 0, -1);
    const overdueTasks: { id: string; title: string; dueDate: string; daysOverdue: number }[] = [];

    if (taskIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of taskIds) {
        pipeline.get(`task:${id}`);
      }
      const tasks = await pipeline.exec<(Task | null)[]>();

      for (const task of tasks) {
        if (!task || task.completed) continue;
        if (task.due_date < today) {
          const daysOverdue = Math.floor(
            (now - new Date(task.due_date).getTime()) / 86400000
          );
          overdueTasks.push({
            id: task.id,
            title: task.title,
            dueDate: task.due_date,
            daysOverdue,
          });
        }
      }
    }

    const summary = {
      timestamp: new Date().toISOString(),
      staleDeals: staleDeals.length,
      overdueTasks: overdueTasks.length,
      details: {
        staleDeals,
        overdueTasks,
      },
    };

    return NextResponse.json(summary);
  } catch (err) {
    console.error("Cron reminders error:", err);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
