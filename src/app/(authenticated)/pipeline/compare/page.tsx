import { getRedis } from "@/lib/db";
import { CompareDeals } from "@/components/deals/compare-deals";
import type { Deal } from "@/lib/validations";

async function getActiveDeals(): Promise<Deal[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange("deals:active", 0, -1, { rev: true });
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`deal:${id}`);
    }
    const results = await pipeline.exec<(Deal | null)[]>();
    return results.filter((r): r is Deal => r !== null);
  } catch {
    return [];
  }
}

export default async function ComparePage() {
  const deals = await getActiveDeals();

  return <CompareDeals deals={deals} />;
}
