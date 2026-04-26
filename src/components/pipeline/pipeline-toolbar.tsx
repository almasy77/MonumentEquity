"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { GitCompareArrows, Filter, X, Kanban, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportCSVButton } from "@/components/contacts/export-csv-button";
import { AddDealDialog } from "@/components/deals/add-deal-dialog";
import { ImportDealsDialog } from "./import-deals-dialog";
import { KanbanBoard } from "./kanban-board";
import { PipelineTable } from "./pipeline-table";
import type { Deal } from "@/lib/validations";

type ViewMode = "kanban" | "table";

interface Filters {
  state: string;
  city: string;
  minUnits: string;
  maxUnits: string;
}

const EMPTY_FILTERS: Filters = { state: "", city: "", minUnits: "", maxUnits: "" };

export function PipelineToolbar({ deals }: { deals: Deal[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<ViewMode>("kanban");

  const states = useMemo(() => {
    const set = new Set(deals.map((d) => d.state).filter(Boolean));
    return Array.from(set).sort();
  }, [deals]);

  const cities = useMemo(() => {
    const filtered = filters.state
      ? deals.filter((d) => d.state === filters.state)
      : deals;
    const set = new Set(filtered.map((d) => d.city).filter(Boolean));
    return Array.from(set).sort();
  }, [deals, filters.state]);

  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (filters.state && d.state !== filters.state) return false;
      if (filters.city && d.city !== filters.city) return false;
      if (filters.minUnits && d.units < parseInt(filters.minUnits)) return false;
      if (filters.maxUnits && d.units > parseInt(filters.maxUnits)) return false;
      return true;
    });
  }, [deals, filters]);

  const hasActiveFilters = filters.state || filters.city || filters.minUnits || filters.maxUnits;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-slate-400 text-sm mt-1">
            Track deals through every stage
            {hasActiveFilters && (
              <span className="text-blue-400 ml-2">
                ({filteredDeals.length} of {deals.length} deals)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-slate-700 overflow-hidden">
            <button
              onClick={() => setView("kanban")}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                view === "kanban"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Kanban className="h-3.5 w-3.5" />
              Board
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                view === "table"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={`border-slate-700 text-slate-300 hover:text-white ${hasActiveFilters ? "border-blue-500/50 text-blue-400" : ""}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1.5" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1.5 bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {[filters.state, filters.city, filters.minUnits, filters.maxUnits].filter(Boolean).length}
              </span>
            )}
          </Button>
          <ExportCSVButton type="deals" />
          <ImportDealsDialog />
          <Link href="/pipeline/compare">
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:text-white">
              <GitCompareArrows className="h-4 w-4 mr-1.5" />
              Compare
            </Button>
          </Link>
          <AddDealDialog />
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">State</label>
            <Select
              value={filters.state || "__all__"}
              onValueChange={(v) => setFilters((f) => ({ ...f, state: !v || v === "__all__" ? "" : v, city: "" }))}
            >
              <SelectTrigger className="w-[120px] h-8 bg-slate-800 border-slate-700 text-white text-xs">
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="__all__" className="text-white text-xs hover:bg-slate-700">All States</SelectItem>
                {states.map((s) => (
                  <SelectItem key={s} value={s} className="text-white text-xs hover:bg-slate-700">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">City</label>
            <Select
              value={filters.city || "__all__"}
              onValueChange={(v) => setFilters((f) => ({ ...f, city: !v || v === "__all__" ? "" : v }))}
            >
              <SelectTrigger className="w-[150px] h-8 bg-slate-800 border-slate-700 text-white text-xs">
                <SelectValue placeholder="All Cities" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="__all__" className="text-white text-xs hover:bg-slate-700">All Cities</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c} className="text-white text-xs hover:bg-slate-700">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Min Units</label>
            <Input
              type="number"
              value={filters.minUnits}
              onChange={(e) => setFilters((f) => ({ ...f, minUnits: e.target.value }))}
              placeholder="—"
              className="w-[80px] h-8 bg-slate-800 border-slate-700 text-white text-xs"
              min="1"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Max Units</label>
            <Input
              type="number"
              value={filters.maxUnits}
              onChange={(e) => setFilters((f) => ({ ...f, maxUnits: e.target.value }))}
              placeholder="—"
              className="w-[80px] h-8 bg-slate-800 border-slate-700 text-white text-xs"
              min="1"
            />
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-400 hover:text-white"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      )}

      {view === "kanban" ? (
        <KanbanBoard deals={filteredDeals} />
      ) : (
        <PipelineTable deals={filteredDeals} />
      )}
    </>
  );
}
