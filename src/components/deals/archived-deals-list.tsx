"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RotateCcw, Trash2, ExternalLink, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/validations";

function formatCurrency(n?: number): string {
  if (typeof n !== "number") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const isDead = status === "dead";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isDead
          ? "bg-red-500/10 text-red-400"
          : "bg-yellow-500/10 text-yellow-400"
      }`}
    >
      {isDead ? "Dead" : "Passed"}
    </span>
  );
}

export function ArchivedDealsList({
  deals,
  isAdmin,
}: {
  deals: Deal[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reactivate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/deals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to reactivate deal");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to reactivate deal");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(deal: Deal) {
    if (
      !confirm(
        `Permanently delete "${deal.address}"? This removes the deal and all its scenarios, tasks, checklists, and uploaded files. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(deal.id);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete deal");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete deal");
    } finally {
      setBusyId(null);
    }
  }

  if (deals.length === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
          <Archive className="h-8 w-8" />
          <p className="text-sm">No archived deals.</p>
          <p className="text-xs">
            Deals you mark as dead or passed will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-0 divide-y divide-slate-800">
        {deals.map((deal) => (
          <div
            key={deal.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/deals/${deal.id}`}
                  className="truncate font-medium text-white hover:text-blue-400 hover:underline"
                >
                  {deal.address}
                </Link>
                <StatusBadge status={deal.status} />
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {[deal.city, deal.state].filter(Boolean).join(", ")}
                {deal.units ? ` · ${deal.units} units` : ""}
                {" · "}
                {formatCurrency(deal.asking_price)}
                {(deal.kill_reason || deal.pass_reason) && (
                  <span className="text-slate-600">
                    {" · "}
                    {deal.kill_reason || deal.pass_reason}
                  </span>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/deals/${deal.id}`}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                Edit
              </Link>
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === deal.id}
                onClick={() => reactivate(deal.id)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                Reactivate
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === deal.id}
                  onClick={() => remove(deal)}
                  className="border-red-900/50 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
