"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import type { Deal } from "@/lib/validations";

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function DealCard({ deal }: { deal: Deal }) {
  const daysInPipeline = daysSince(deal.created_at);
  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;

  return (
    <Link href={`/deals/${deal.id}`}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 hover:border-blue-500/50 transition-colors cursor-pointer group">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-sm font-medium text-white truncate">
              {deal.address}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <span>{deal.city}, {deal.state}</span>
          <span className="text-slate-600">|</span>
          <span>{deal.units} units</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-400">
            {formatCurrency(deal.asking_price)}
          </span>
          <span className="text-xs text-slate-500">
            {formatCurrency(pricePerUnit)}/unit
          </span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {deal.source}
          </Badge>
          <span className="text-xs text-slate-500">
            {daysInPipeline}d
          </span>
        </div>
      </div>
    </Link>
  );
}
