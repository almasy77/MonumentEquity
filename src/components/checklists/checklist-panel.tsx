"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Plus, Loader2, Archive, Pencil, Check, X, CheckSquare } from "lucide-react";
import type { ChecklistInstance, ChecklistItem } from "@/lib/checklist-templates";

const TYPE_LABELS: Record<string, string> = {
  screening: "Screening",
  diligence: "Due Diligence",
  closing: "Closing",
  onboarding: "First 100 Days",
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");

  const existingTypes = new Set(checklists.map((c) => c.type));
  const availableTypes = (["screening", "diligence", "closing", "onboarding"] as const).filter(
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
                  completed_at: !item.completed ? new Date().toISOString() : undefined,
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

  async function saveItemEdit(checklistId: string, itemId: string) {
    const cl = checklists.find((c) => c.id === checklistId);
    if (!cl) return;
    const updatedItems = cl.items.map((item) =>
      item.id === itemId ? { ...item, label: editLabel } : item
    );
    setChecklists((prev) =>
      prev.map((c) => (c.id === checklistId ? { ...c, items: updatedItems } : c))
    );
    setEditingItem(null);

    try {
      await fetch(`/api/checklists/${checklistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updatedItems }),
      });
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  }

  async function addItem(checklistId: string) {
    if (!newItemLabel.trim()) return;
    const cl = checklists.find((c) => c.id === checklistId);
    if (!cl) return;
    const categories = [...new Set(cl.items.map((i) => i.category))];
    const category = newItemCategory.trim() || categories[0] || "General";
    const newItem: ChecklistItem = {
      id: `custom-${Date.now()}`,
      label: newItemLabel.trim(),
      category,
      completed: false,
    };
    const updatedItems = [...cl.items, newItem];
    setChecklists((prev) =>
      prev.map((c) => (c.id === checklistId ? { ...c, items: updatedItems } : c))
    );
    setNewItemLabel("");
    setNewItemCategory("");
    setAddingTo(null);

    try {
      await fetch(`/api/checklists/${checklistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updatedItems }),
      });
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  }

  function toggleCategory(key: string) {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function groupByCategory(items: ChecklistItem[]) {
    const groups: Record<string, ChecklistItem[]> = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }

  const visibleChecklists = checklists.filter((c) => !archivedIds.has(c.id));
  const archivedChecklists = checklists.filter((c) => archivedIds.has(c.id));

  // Overall progress
  const totalItems = checklists.reduce((sum, cl) => sum + cl.items.length, 0);
  const totalCompleted = checklists.reduce((sum, cl) => sum + cl.items.filter((i) => i.completed).length, 0);

  return (
    <CollapsibleCard
      title="Checklists"
      icon={<CheckSquare className="h-4 w-4 text-blue-400" />}
      headerRight={
        totalItems > 0 ? (
          <span className="text-xs text-slate-400">{totalCompleted}/{totalItems} complete</span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Create buttons */}
        {availableTypes.length > 0 && (
          <div className="flex gap-2 flex-wrap">
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

        {visibleChecklists.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">
            No checklists yet. Create one above to get started.
          </p>
        )}

        {/* Each checklist as a subcard */}
        {visibleChecklists.map((cl) => {
          const completedCount = cl.items.filter((i) => i.completed).length;
          const totalCount = cl.items.length;
          const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
          const groups = groupByCategory(cl.items);
          const isCollapsed = collapsed[cl.id] ?? false;

          return (
            <div key={cl.id} className="bg-slate-800/50 border border-slate-800 rounded-lg">
              {/* Subcard header */}
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => toggleCollapsed(cl.id)}
                  className="flex items-center gap-2 text-left group"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-300" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-300" />
                  )}
                  <span className="text-sm font-medium text-white">
                    {TYPE_LABELS[cl.type]}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      pct === 100
                        ? "border-green-600 text-green-400"
                        : pct >= 50
                        ? "border-blue-600 text-blue-400"
                        : "border-slate-600 text-slate-400"
                    }`}
                  >
                    {completedCount}/{totalCount} ({pct}%)
                  </Badge>
                  <button
                    onClick={() => setAddingTo(addingTo === cl.id ? null : cl.id)}
                    className="p-1 text-slate-500 hover:text-slate-300"
                    title="Add item"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setArchivedIds((prev) => new Set([...prev, cl.id]))}
                    className="p-1 text-slate-500 hover:text-yellow-400"
                    title="Archive checklist"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-3 pb-1">
                <div className="w-full bg-slate-800 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full transition-all ${
                      pct === 100
                        ? "bg-green-500"
                        : pct >= 50
                        ? "bg-blue-500"
                        : "bg-slate-600"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Subcard content */}
              {!isCollapsed && (
                <div className="px-3 pb-3 pt-1">
                  {/* Add item form */}
                  {addingTo === cl.id && (
                    <div className="mb-3 p-2 border border-slate-700 rounded space-y-2">
                      <Input
                        value={newItemLabel}
                        onChange={(e) => setNewItemLabel(e.target.value)}
                        placeholder="New item label..."
                        className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") addItem(cl.id); }}
                      />
                      <div className="flex gap-2">
                        <Input
                          value={newItemCategory}
                          onChange={(e) => setNewItemCategory(e.target.value)}
                          placeholder="Category (optional)"
                          className="bg-slate-800 border-slate-700 text-white h-7 text-xs"
                        />
                        <Button size="sm" onClick={() => addItem(cl.id)} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white">
                          Add
                        </Button>
                      </div>
                    </div>
                  )}

                  {Object.entries(groups).map(([category, items]) => {
                    const catKey = `${cl.id}:${category}`;
                    const isExpanded = expandedCategories[catKey] !== false;
                    const catCompleted = items.filter((i) => i.completed).length;

                    return (
                      <div key={catKey} className="mb-1.5">
                        <button
                          onClick={() => toggleCategory(catKey)}
                          className="flex items-center gap-1 w-full text-left py-1 text-xs font-medium text-slate-400 hover:text-slate-300"
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
                          <div className="ml-4 space-y-0.5">
                            {items.map((item) => (
                              <div key={item.id} className="flex items-center gap-2 py-0.5 group">
                                <Checkbox
                                  checked={item.completed}
                                  onCheckedChange={() => toggleItem(cl.id, item.id)}
                                  className="border-slate-600"
                                />
                                {editingItem === item.id ? (
                                  <div className="flex items-center gap-1 flex-1">
                                    <Input
                                      value={editLabel}
                                      onChange={(e) => setEditLabel(e.target.value)}
                                      className="bg-slate-800 border-slate-700 text-white h-6 text-xs flex-1"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveItemEdit(cl.id, item.id);
                                        if (e.key === "Escape") setEditingItem(null);
                                      }}
                                    />
                                    <button onClick={() => saveItemEdit(cl.id, item.id)} className="p-0.5 text-green-400 hover:text-green-300">
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <button onClick={() => setEditingItem(null)} className="p-0.5 text-slate-500 hover:text-slate-300">
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span
                                      className={`text-xs flex-1 ${
                                        item.completed
                                          ? "text-slate-500 line-through"
                                          : "text-slate-300"
                                      }`}
                                    >
                                      {item.label}
                                    </span>
                                    <button
                                      onClick={() => { setEditingItem(item.id); setEditLabel(item.label); }}
                                      className="p-0.5 text-slate-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Edit item"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Archived checklists */}
        {archivedChecklists.length > 0 && (
          <div className="border-t border-slate-800 pt-3">
            <p className="text-xs text-slate-500 mb-2">Archived ({archivedChecklists.length})</p>
            <div className="space-y-1">
              {archivedChecklists.map((cl) => (
                <div key={cl.id} className="flex items-center justify-between text-xs text-slate-500">
                  <span>{TYPE_LABELS[cl.type]}</span>
                  <button
                    onClick={() => setArchivedIds((prev) => {
                      const next = new Set(prev);
                      next.delete(cl.id);
                      return next;
                    })}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
