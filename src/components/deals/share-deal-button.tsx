"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Share2,
  Download,
  FileText,
  ChevronDown,
  Check,
  Loader2,
  Link,
} from "lucide-react";

interface ShareDealButtonProps {
  dealId: string;
  scenarioId?: string;
}

export function ShareDealButton({ dealId, scenarioId }: ShareDealButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleCopyShareLink() {
    setLoading(true);
    setOpen(false);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, expires_days: 30 }),
      });

      if (!res.ok) throw new Error("Failed to create share link");

      const data = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error("Failed to share:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleExportXlsx() {
    if (!scenarioId) return;
    setOpen(false);
    window.open(`/api/export/${dealId}?scenario_id=${scenarioId}`, "_blank");
  }

  function handleExportPdf() {
    setOpen(false);
    const url = scenarioId
      ? `/api/export/${dealId}/pdf?scenario_id=${scenarioId}`
      : `/api/export/${dealId}/pdf`;
    window.open(url, "_blank");
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        className="border-slate-700 text-slate-400 hover:bg-slate-800"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : copied ? (
          <>
            <Check className="h-3.5 w-3.5 mr-1 text-green-400" />
            <span className="text-green-400">Copied!</span>
          </>
        ) : (
          <>
            <Share2 className="h-3.5 w-3.5 mr-1" />
            Share
            <ChevronDown className="h-3 w-3 ml-1" />
          </>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-slate-700 bg-slate-800 py-1 shadow-lg">
          <button
            onClick={handleCopyShareLink}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Link className="h-4 w-4 text-slate-400" />
            Copy Share Link
          </button>

          <button
            onClick={handleExportXlsx}
            disabled={!scenarioId}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300"
          >
            <Download className="h-4 w-4 text-slate-400" />
            Export XLSX
            {!scenarioId && (
              <span className="ml-auto text-xs text-slate-500">
                No scenario
              </span>
            )}
          </button>

          <button
            onClick={handleExportPdf}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <FileText className="h-4 w-4 text-slate-400" />
            Export PDF
          </button>
        </div>
      )}
    </div>
  );
}
