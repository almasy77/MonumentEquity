import { notFound } from "next/navigation";
import Link from "next/link";
import { getRedis } from "@/lib/db";
import { ArrowLeft } from "lucide-react";
import { UnderwritingClient } from "@/components/underwriting/underwriting-client";
import type { Deal, Scenario } from "@/lib/validations";

async function getDeal(id: string): Promise<Deal | null> {
  try {
    const redis = getRedis();
    return await redis.get<Deal>(`deal:${id}`);
  } catch {
    return null;
  }
}

async function getScenarios(dealId: string): Promise<Scenario[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange(`scenarios:by_deal:${dealId}`, 0, -1, { rev: true });
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`scenario:${id}`);
    }
    const results = await pipeline.exec<(Scenario | null)[]>();
    return results.filter((r): r is Scenario => r !== null);
  } catch {
    return [];
  }
}

export default async function UnderwritePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();

  const scenarios = await getScenarios(id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/deals/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-blue-400 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Deal
        </Link>
        <h1 className="text-2xl font-bold text-white">
          Underwrite: {deal.address}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {deal.city}, {deal.state} — {deal.units} units — ${deal.asking_price.toLocaleString()}
        </p>
      </div>

      <UnderwritingClient deal={deal} initialScenarios={scenarios} />
    </div>
  );
}
