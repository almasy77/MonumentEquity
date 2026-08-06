import { auth } from "@/lib/auth";
import { getRedis, scanKeys } from "@/lib/db";
import { Archive } from "lucide-react";
import { ArchivedDealsList } from "@/components/deals/archived-deals-list";
import type { Deal } from "@/lib/validations";

async function getInactiveDeals(): Promise<Deal[]> {
  try {
    const redis = getRedis();
    const keys = await scanKeys("deal:*");
    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec<(Deal | null)[]>();

    return results
      .filter((d): d is Deal => d !== null && (d.status === "dead" || d.status === "passed"))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  } catch {
    return [];
  }
}

export default async function ArchivedDealsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const deals = await getInactiveDeals();
  const isAdmin = session.user.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Archive className="h-6 w-6 text-slate-400" />
          Archived Deals
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Deals you&apos;ve marked dead or passed. Reactivate to move one back into the
          pipeline, or delete it permanently.
        </p>
      </div>

      <ArchivedDealsList deals={deals} isAdmin={isAdmin} />
    </div>
  );
}
