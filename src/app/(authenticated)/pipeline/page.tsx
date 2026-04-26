import { getRedis } from "@/lib/db";
import { PipelineToolbar } from "@/components/pipeline/pipeline-toolbar";
import type { Deal } from "@/lib/validations";

async function getDeals(): Promise<Deal[]> {
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

export default async function PipelinePage() {
  const deals = await getDeals();

  return (
    <div className="space-y-6">
      <PipelineToolbar deals={deals} />
    </div>
  );
}
