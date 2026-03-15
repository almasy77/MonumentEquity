"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import type { Deal } from "@/lib/validations";

const SELECTABLE_STAGES = DEAL_STAGES.filter((s) => s !== "stabilized");

export function DealStageSelector({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);

  async function handleStageChange(newStage: DealStage) {
    if (newStage === deal.stage || deal.status !== "active") return;
    setUpdating(true);

    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Stage update failed:", data.error);
      }

      router.refresh();
    } catch (err) {
      console.error("Failed to update stage:", err);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Select
      value={deal.stage}
      onValueChange={(v) => handleStageChange(v as DealStage)}
      disabled={updating || deal.status !== "active"}
    >
      <SelectTrigger className="w-[160px] bg-slate-800 border-slate-700 text-white">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-slate-800 border-slate-700">
        {SELECTABLE_STAGES.map((stage) => (
          <SelectItem
            key={stage}
            value={stage}
            className="text-white hover:bg-slate-700"
          >
            {STAGE_LABELS[stage]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
