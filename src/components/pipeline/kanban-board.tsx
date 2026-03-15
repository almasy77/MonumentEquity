"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import { DealCard } from "./deal-card";
import type { Deal } from "@/lib/validations";

const VISIBLE_STAGES = DEAL_STAGES.filter((s) => s !== "stabilized");

export function KanbanBoard({ deals }: { deals: Deal[] }) {
  const router = useRouter();
  const [draggingDeal, setDraggingDeal] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  const dealsByStage = VISIBLE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = deals.filter((d) => d.stage === stage && d.status === "active");
      return acc;
    },
    {} as Record<DealStage, Deal[]>
  );

  function handleDragStart(dealId: string) {
    setDraggingDeal(dealId);
  }

  function handleDragOver(e: React.DragEvent, stage: DealStage) {
    e.preventDefault();
    setDragOverStage(stage);
  }

  function handleDragLeave() {
    setDragOverStage(null);
  }

  async function handleDrop(e: React.DragEvent, newStage: DealStage) {
    e.preventDefault();
    setDragOverStage(null);

    if (!draggingDeal) return;

    const deal = deals.find((d) => d.id === draggingDeal);
    if (!deal || deal.stage === newStage) {
      setDraggingDeal(null);
      return;
    }

    try {
      await fetch(`/api/deals/${draggingDeal}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to update stage:", err);
    } finally {
      setDraggingDeal(null);
    }
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {VISIBLE_STAGES.map((stage) => {
        const stageDeals = dealsByStage[stage] || [];
        const isOver = dragOverStage === stage;

        return (
          <div key={stage} className="flex-shrink-0 w-72">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-300">
                {STAGE_LABELS[stage]}
              </h3>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                {stageDeals.length}
              </span>
            </div>

            <div
              className={`min-h-[200px] rounded-lg border-2 border-dashed p-2 space-y-2 transition-colors ${
                isOver
                  ? "border-blue-500/50 bg-blue-500/5"
                  : "border-transparent"
              }`}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
            >
              {stageDeals.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-600 text-sm">
                  No deals
                </div>
              ) : (
                stageDeals.map((deal) => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={() => handleDragStart(deal.id)}
                    className={`${
                      draggingDeal === deal.id ? "opacity-50" : ""
                    }`}
                  >
                    <DealCard deal={deal} />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
