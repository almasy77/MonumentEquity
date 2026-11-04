import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/db";

const limiters = new Map<string, Ratelimit>();

/**
 * Sliding-window limiter keyed by `bucket` + `identifier`. Fails OPEN on a Redis
 * error: these limits are abuse brakes, and an outage must not lock Bryan out.
 */
export async function allow(
  bucket: string,
  identifier: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const name = `${bucket}:${max}:${windowSeconds}`;
    let rl = limiters.get(name);
    if (!rl) {
      rl = new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
        prefix: `rl:${bucket}`,
      });
      limiters.set(name, rl);
    }
    const { success } = await rl.limit(identifier);
    return success;
  } catch (err) {
    console.error("rate limit check failed (allowing):", err);
    return true;
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
