import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Scenario } from "@/lib/validations";

// One-time (re-runnable) reclaim: scenarios persist a full monthly pro forma that
// nothing reads (GET/export/PDF all recompute from inputs), so it's dead weight in
// Redis. This scans every scenario and trims monthly_pro_forma to [], reporting how
// much it freed. New writes already store [] — this cleans up pre-existing records.
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const redis = getRedis();
    let cursor = "0";
    let scanned = 0;
    let trimmed = 0;
    let bytesFreed = 0;

    do {
      const [next, keys] = await redis.scan(cursor, { match: "scenario:*", count: 200 });
      cursor = String(next);
      if (keys.length === 0) continue;

      const readPipe = redis.pipeline();
      for (const k of keys) readPipe.get(k);
      const scenarios = await readPipe.exec<(Scenario | null)[]>();

      const writePipe = redis.pipeline();
      let hasWrites = false;
      for (let i = 0; i < keys.length; i++) {
        scanned++;
        const s = scenarios[i];
        if (s && Array.isArray(s.monthly_pro_forma) && s.monthly_pro_forma.length > 0) {
          bytesFreed += JSON.stringify(s.monthly_pro_forma).length;
          s.monthly_pro_forma = [];
          writePipe.set(keys[i], JSON.stringify(s));
          trimmed++;
          hasWrites = true;
        }
      }
      if (hasWrites) await writePipe.exec();
    } while (cursor !== "0");

    return NextResponse.json({
      scanned,
      trimmed,
      approx_bytes_freed: bytesFreed,
      approx_mb_freed: Math.round((bytesFreed / (1024 * 1024)) * 10) / 10,
    });
  } catch (err) {
    console.error("POST /api/admin/storage-cleanup error:", err);
    return NextResponse.json({ error: "Storage cleanup failed" }, { status: 500 });
  }
}
