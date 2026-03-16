"use client";

import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleCardProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CollapsibleCard({
  title,
  icon,
  defaultOpen = true,
  headerRight,
  children,
  className = "",
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={`bg-slate-900 border-slate-800 ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 text-left group"
          >
            {open ? (
              <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
            )}
            {icon}
            <CardTitle className="text-white text-base">{title}</CardTitle>
          </button>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </div>
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
