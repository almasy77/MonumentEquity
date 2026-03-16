"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { EditableField } from "./editable-field";
import type { Deal } from "@/lib/validations";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function EditableMetrics({ deal }: { deal: Deal }) {
  const router = useRouter();

  async function updateDeal(field: string, value: string) {
    const parsed = value ? Number(value.replace(/,/g, "")) : undefined;
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    if (!res.ok) throw new Error("Failed to update");
    router.refresh();
  }

  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(deal.created_at).getTime()) / 86400000
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 pb-3 px-4">
          <EditableField
            label="Asking Price"
            value={deal.asking_price.toString()}
            onSave={(v) => updateDeal("asking_price", v)}
            type="number"
            prefix="$"
          />
        </CardContent>
      </Card>
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 pb-3 px-4">
          <EditableField
            label="Bid Price"
            value={deal.bid_price?.toString() || ""}
            onSave={(v) => updateDeal("bid_price", v)}
            type="number"
            prefix="$"
            placeholder="Enter bid"
          />
        </CardContent>
      </Card>
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 pb-3 px-4">
          <EditableField
            label="Units"
            value={deal.units.toString()}
            onSave={(v) => updateDeal("units", v)}
            type="number"
          />
        </CardContent>
      </Card>
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-slate-500 mb-1">Price / Unit</p>
          <p className="text-lg font-bold text-white">{formatCurrency(pricePerUnit)}</p>
        </CardContent>
      </Card>
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-slate-500 mb-1">Days in Pipeline</p>
          <p className="text-lg font-bold text-white">{daysSinceCreated}</p>
        </CardContent>
      </Card>
    </div>
  );
}
