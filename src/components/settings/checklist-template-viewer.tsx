"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import {
  SCREENING_TEMPLATE,
  DD_TEMPLATE,
  CLOSING_TEMPLATE,
  ONBOARDING_TEMPLATE,
} from "@/lib/checklist-templates";

const TEMPLATES = [
  { key: "screening", label: "Screening", items: SCREENING_TEMPLATE, color: "text-yellow-400" },
  { key: "diligence", label: "Due Diligence", items: DD_TEMPLATE, color: "text-blue-400" },
  { key: "closing", label: "Closing", items: CLOSING_TEMPLATE, color: "text-green-400" },
  { key: "onboarding", label: "First 100 Days", items: ONBOARDING_TEMPLATE, color: "text-purple-400" },
] as const;

export function ChecklistTemplateViewer() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {TEMPLATES.map((tmpl) => {
        const isOpen = expanded === tmpl.key;
        const categories = [...new Set(tmpl.items.map((i) => i.category))];

        return (
          <div key={tmpl.key} className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : tmpl.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ClipboardList className={`h-4 w-4 ${tmpl.color}`} />
                <span className="text-sm font-medium text-white">{tmpl.label}</span>
                <Badge variant="outline" className="text-xs border-slate-700 text-slate-400">
                  {tmpl.items.length} items
                </Badge>
              </div>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-500" />
              )}
            </button>

            {isOpen && (
              <div className="px-4 pb-3 space-y-3">
                {categories.map((cat) => {
                  const catItems = tmpl.items.filter((i) => i.category === cat);
                  return (
                    <div key={cat}>
                      <h5 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                        {cat} ({catItems.length})
                      </h5>
                      <ul className="space-y-0.5">
                        {catItems.map((item) => (
                          <li key={item.id} className="text-sm text-slate-300 pl-3 border-l border-slate-800">
                            {item.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-500 mt-2">
        Templates are sourced from the Durham First-Deal Playbook. Custom template editing coming soon.
      </p>
    </div>
  );
}
