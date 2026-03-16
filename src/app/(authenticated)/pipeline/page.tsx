import Link from "next/link";
import { GitCompareArrows } from "lucide-react";
import { getRedis } from "@/lib/db";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { AddDealDialog } from "@/components/deals/add-deal-dialog";
import { Button } from "@/components/ui/button";
import { ExportCSVButton } from "@/components/contacts/export-csv-button";
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-slate-400 text-sm mt-1">
            Track deals through every stage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton type="deals" />
          <Link href="/pipeline/compare">
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:text-white">
              <GitCompareArrows className="h-4 w-4 mr-1.5" />
              Compare
            </Button>
          </Link>
          <AddDealDialog />
        </div>
      </div>

      <KanbanBoard deals={deals} />
    </div>
  );
}
