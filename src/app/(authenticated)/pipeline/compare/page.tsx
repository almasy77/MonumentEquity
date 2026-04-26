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

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deals = await getActiveDeals();
  const params = await searchParams;

  const filters = {
    state: typeof params.state === "string" ? params.state : undefined,
    city: typeof params.city === "string" ? params.city : undefined,
    minUnits: typeof params.minUnits === "string" ? parseInt(params.minUnits) || undefined : undefined,
    maxUnits: typeof params.maxUnits === "string" ? parseInt(params.maxUnits) || undefined : undefined,
  };

  const hasFilters = filters.state || filters.city || filters.minUnits || filters.maxUnits;

  return <CompareDeals deals={deals} filters={hasFilters ? filters : undefined} />;
}
