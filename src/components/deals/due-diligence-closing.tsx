"use client";

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { EditableField } from "./editable-field";
import { ClipboardCheck } from "lucide-react";
import type { Deal } from "@/lib/validations";

export function DueDiligenceClosing({ deal }: { deal: Deal }) {
  const router = useRouter();

  async function updateDeal(field: string, value: string) {
    let parsed: unknown = value;
    if (field === "final_purchase_price") {
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
      title="Due Diligence & Closing"
      icon={<ClipboardCheck className="h-4 w-4 text-amber-400" />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <EditableField label="DD Start Date" value={deal.dd_start_date || ""} onSave={(v) => updateDeal("dd_start_date", v)} type="date" />
        <EditableField label="DD End Date" value={deal.dd_end_date || ""} onSave={(v) => updateDeal("dd_end_date", v)} type="date" />
        <EditableField label="Closing Date" value={deal.closing_date || ""} onSave={(v) => updateDeal("closing_date", v)} type="date" />
        <EditableField label="Final Purchase Price" value={deal.final_purchase_price?.toString() || ""} onSave={(v) => updateDeal("final_purchase_price", v)} type="number" prefix="$" placeholder="Agreed price" />
      </div>
    </CollapsibleCard>
  );
}
