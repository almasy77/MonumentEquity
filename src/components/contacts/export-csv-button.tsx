"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { AdminOnly } from "@/components/layout/admin-only";

export function ExportCSVButton({ type }: { type: "deals" | "contacts" }) {
  return (
    <AdminOnly>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          window.location.href = `/api/export/csv?type=${type}`;
        }}
        className="border-slate-700 text-slate-300 hover:bg-slate-800"
      >
        <Download className="h-4 w-4 mr-1.5" />
        Export CSV
      </Button>
    </AdminOnly>
  );
}
