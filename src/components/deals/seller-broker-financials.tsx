"use client";

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { EditableField } from "./editable-field";
import { DollarSign } from "lucide-react";
import type { Deal } from "@/lib/validations";

export function SellerBrokerFinancials({ deal }: { deal: Deal }) {
  const router = useRouter();

  async function updateDeal(field: string, value: string) {
    let parsed: unknown = value;
    const numericFields = ["current_noi", "current_occupancy", "current_annual_taxes", "current_annual_insurance"];
    if (numericFields.includes(field)) {
      parsed = value ? Number(value.replace(/,/g, "")) : undefined;
    }

    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    if (!res.ok) throw new Error("Failed to update");
    router.refresh();
  }

  return (
    <CollapsibleCard
      title="Seller / Broker Financials"
      icon={<DollarSign className="h-4 w-4 text-green-400" />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <EditableField label="Current NOI" value={deal.current_noi?.toString() || ""} onSave={(v) => updateDeal("current_noi", v)} type="number" prefix="$" placeholder="Annual NOI" />
        <EditableField label="Occupancy" value={deal.current_occupancy ? (deal.current_occupancy * 100).toFixed(1) : ""} onSave={(v) => updateDeal("current_occupancy", (Number(v) / 100).toString())} type="number" suffix="%" placeholder="e.g. 92" />
        <EditableField label="Annual Taxes" value={deal.current_annual_taxes?.toString() || ""} onSave={(v) => updateDeal("current_annual_taxes", v)} type="number" prefix="$" placeholder="Property taxes" />
        <EditableField label="Annual Insurance" value={deal.current_annual_insurance?.toString() || ""} onSave={(v) => updateDeal("current_annual_insurance", v)} type="number" prefix="$" placeholder="Insurance premium" />
        <EditableField label="Tax Records URL" value={deal.tax_record_url || ""} onSave={(v) => updateDeal("tax_record_url", v)} type="url" placeholder="County tax assessor link" />
      </div>
      {deal.tax_record_url && (
        <a href={deal.tax_record_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs inline-flex items-center gap-1 mt-2">
          View Tax Records
        </a>
      )}
    </CollapsibleCard>
  );
}
