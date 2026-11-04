"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
        enabled ? "bg-blue-600" : "bg-slate-700"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        } mt-0.5`}
      />
    </button>
  );
}

export function CrmEmailForm({
  initialAutoCreate,
  inboundAddress,
}: {
  initialAutoCreate: boolean;
  inboundAddress: string | null;
}) {
  const [autoCreate, setAutoCreate] = useState(initialAutoCreate);
  const [saved, setSaved] = useState(initialAutoCreate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const dirty = autoCreate !== saved;

  async function handleSave() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch("/api/settings/crm-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_create: autoCreate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      const data = await res.json();
      setSaved(!!data.autoCreate);
      setAutoCreate(!!data.autoCreate);
      setSuccess("Saved");
      setTimeout(() => setSuccess(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-white">Auto-create contacts from email</p>
          <p className="text-[12px] text-slate-400 mt-0.5">
            When a BCC&apos;d email has an external party with no matching contact, create the
            contact automatically. Turn this off to hold them in the{" "}
            <span className="text-slate-300">New contacts from email</span> review inbox instead.
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {autoCreate ? "On — unknown senders become contacts immediately." : "Off — unknown senders wait for your review."}
          </p>
        </div>
        <Toggle enabled={autoCreate} onToggle={() => setAutoCreate((v) => !v)} disabled={loading} />
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
        Inbound / BCC address:{" "}
        {inboundAddress ? (
          <span className="text-slate-200">{inboundAddress}</span>
        ) : (
          <span className="text-amber-400">not configured — set CRM_INBOUND_ADDRESS to enable logging</span>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={loading || !dirty}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
        {success && (
          <span className="flex items-center gap-1 text-green-400 text-sm">
            <Check className="h-4 w-4" /> {success}
          </span>
        )}
      </div>
    </div>
  );
}
