"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, XCircle, SkipForward, RotateCcw } from "lucide-react";
import type { Deal } from "@/lib/validations";

export function DealStatusActions({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);

  async function updateStatus(status: string, extra?: Record<string, string>) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Status update failed:", data.error);
      }

      router.refresh();
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setUpdating(false);
    }
  }

  if (deal.status !== "active") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={updating}
        onClick={() => updateStatus("active")}
        className="border-slate-700 text-slate-300 hover:bg-slate-800"
      >
        <RotateCcw className="h-4 w-4 mr-1" />
        Reactivate
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            disabled={updating}
            className="border-slate-700 text-slate-400 hover:bg-slate-800"
          />
        }
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-slate-800 border-slate-700"
      >
        <DropdownMenuItem
          onClick={() => updateStatus("dead", { kill_reason: "Marked dead" })}
          className="text-red-400 hover:bg-slate-700 cursor-pointer"
        >
          <XCircle className="h-4 w-4 mr-2" />
          Mark Dead
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => updateStatus("passed", { pass_reason: "Passed on deal" })}
          className="text-yellow-400 hover:bg-slate-700 cursor-pointer"
        >
          <SkipForward className="h-4 w-4 mr-2" />
          Pass
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
