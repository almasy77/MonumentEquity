"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Database } from "lucide-react";

export function StorageCleanupButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ scanned: number; trimmed: number; approx_mb_freed: number } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/storage-cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cleanup failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Scenarios stored a full monthly pro forma that nothing reads (it&apos;s recomputed
        on every load). This reclaims that dead weight from the database. Safe to run
        anytime — it never touches your assumptions or deals.
      </p>
      <Button onClick={run} disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white">
        {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Database className="h-4 w-4 mr-1.5" />}
        {running ? "Cleaning up…" : "Run storage cleanup"}
      </Button>
      {result && (
        <p className="text-sm text-emerald-400 tabular-nums">
          Trimmed {result.trimmed.toLocaleString()} of {result.scanned.toLocaleString()} scenarios · reclaimed ~{result.approx_mb_freed} MB.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
