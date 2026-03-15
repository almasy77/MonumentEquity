"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Plus, Loader2 } from "lucide-react";
import type { ChecklistInstance, ChecklistItem } from "@/lib/checklist-templates";

const TYPE_LABELS: Record<string, string> = {
  diligence: "Due Diligence",
  closing: "Closing",
  onboarding: "Onboarding",
};

export function ChecklistPanel({
  dealId,
  checklists: initial,
}: {
  dealId: string;
  checklists: ChecklistInstance[];
}) {
  const router = useRouter();
  const [checklists, setChecklists] = useState(initial);
  const [creating, setCreating] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({});

  const existingTypes = new Set(checklists.map((c) => c.type));
  const availableTypes = (["diligence", "closing", "onboarding"] as const).filter(
    (t) => !existingTypes.has(t)
  );

  async function createChecklist(type: string) {
    setCreating(type);
    try {
      const res = await fetch("/api/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, type }),
      });
      if (res.ok) {
        const cl = await res.json();
        setChecklists((prev) => [...prev, cl]);
      }
    } catch (err) {
      console.error("Failed to create checklist:", err);
    } finally {
      setCreating(null);
    }
  }

  async function toggleItem(checklistId: string, itemId: string) {
    // Optimistic update
    setChecklists((prev) =>
      prev.map((cl) => {
        if (cl.id !== checklistId) return cl;
        return {
          ...cl,
          items: cl.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  completed: !item.completed,
                  completed_at: !item.completed
                    ? new Date().toISOString()
                    : undefined,
                }
              : item
          ),
        };
      })
    );

    try {
      await fetch(`/api/checklists/${checklistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to toggle item:", err);
    }
  }

  function toggleCategory(key: string) {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function groupByCategory(items: ChecklistItem[]) {
    const groups: Record<string, ChecklistItem[]> = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }

  return (
    <div className="space-y-4">
      {availableTypes.length > 0 && (
        <div className="flex gap-2">
          {availableTypes.map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => createChecklist(type)}
              disabled={creating !== null}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              {creating === type ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              {TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
      )}

      {checklists.length === 0 && (
        <p className="text-sm text-slate-500 text-center py-6">
          No checklists yet. Create one above to get started.
        </p>
      )}

      {checklists.map((cl) => {
        const completedCount = cl.items.filter((i) => i.completed).length;
        const totalCount = cl.items.length;
        const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
        const groups = groupByCategory(cl.items);

        return (
          <Card key={cl.id} className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-base">
                  {TYPE_LABELS[cl.type]}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      pct === 100
                        ? "border-green-600 text-green-400"
                        : pct >= 50
                        ? "border-blue-600 text-blue-400"
                        : "border-slate-600 text-slate-400"
                    }`}
                  >
                    {completedCount}/{totalCount} ({pct}%)
                  </Badge>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    pct === 100
                      ? "bg-green-500"
                      : pct >= 50
                      ? "bg-blue-500"
                      : "bg-slate-600"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {Object.entries(groups).map(([category, items]) => {
                const catKey = `${cl.id}:${category}`;
                const isExpanded = expandedCategories[catKey] !== false; // default open
                const catCompleted = items.filter((i) => i.completed).length;

                return (
                  <div key={catKey} className="mb-2">
                    <button
                      onClick={() => toggleCategory(catKey)}
                      className="flex items-center gap-1 w-full text-left py-1.5 text-xs font-medium text-slate-400 hover:text-slate-300"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {category}
                      <span className="text-slate-600 ml-1">
                        ({catCompleted}/{items.length})
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="ml-4 space-y-1">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 py-1"
                          >
                            <Checkbox
                              checked={item.completed}
                              onCheckedChange={() =>
                                toggleItem(cl.id, item.id)
                              }
                              className="border-slate-600"
                            />
                            <span
                              className={`text-sm ${
                                item.completed
                                  ? "text-slate-500 line-through"
                                  : "text-slate-300"
                              }`}
                            >
                              {item.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
