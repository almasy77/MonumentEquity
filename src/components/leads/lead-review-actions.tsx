"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

export function LeadReviewActions({ pendingId }: { pendingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${pendingId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approve failed");
      router.push(`/deals/${data.deal_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
      setBusy(null);
    }
  }

  async function reject() {
    if (!confirm("Reject this listing? It won't become a deal.")) return;
    setBusy("reject");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${pendingId}/reject`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reject failed");
      router.push("/leads");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={reject}
          disabled={busy !== null}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <X className="h-4 w-4 mr-1" />
          {busy === "reject" ? "Rejecting..." : "Reject"}
        </Button>
        <Button
          size="sm"
          onClick={approve}
          disabled={busy !== null}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Check className="h-4 w-4 mr-1" />
          {busy === "approve" ? "Creating deal..." : "Approve & Create Deal"}
        </Button>
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
