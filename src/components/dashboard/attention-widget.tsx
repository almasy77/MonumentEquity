"use client";

import Link from "next/link";
import { AlertTriangle, Clock, Calendar, Building2 } from "lucide-react";

interface AttentionItem {
  type: "stale_deal" | "overdue_task" | "dd_expiring" | "closing_soon";
  label: string;
  detail: string;
  href: string;
}

export function AttentionWidget({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
        No items need attention right now
      </div>
    );
  }

  const icons = {
    stale_deal: <Building2 className="h-3.5 w-3.5 text-yellow-400" />,
    overdue_task: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />,
    dd_expiring: <Calendar className="h-3.5 w-3.5 text-orange-400" />,
    closing_soon: <Clock className="h-3.5 w-3.5 text-blue-400" />,
  };

  const colors = {
    stale_deal: "border-l-yellow-500",
    overdue_task: "border-l-red-500",
    dd_expiring: "border-l-orange-500",
    closing_soon: "border-l-blue-500",
  };

  return (
    <div className="space-y-2 max-h-[240px] overflow-y-auto">
      {items.map((item, i) => (
        <Link
          key={i}
          href={item.href}
          className={`flex items-start gap-2.5 p-2.5 rounded-lg border-l-2 ${colors[item.type]} bg-slate-800/50 hover:bg-slate-800 transition-colors`}
        >
          <div className="mt-0.5">{icons[item.type]}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate">{item.label}</p>
            <p className="text-xs text-slate-500">{item.detail}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export type { AttentionItem };
