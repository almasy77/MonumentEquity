"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Inbox, Loader2, Check, X } from "lucide-react";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS } from "@/lib/constants";
import type { PendingContact } from "@/lib/validations";

/**
 * CRM inbox: external people found on BCC'd emails with no matching contact.
 * Confirm to create the contact (and attach the originating email) or dismiss.
 * Renders nothing when the queue is empty.
 */
export function ContactInbox() {
  const router = useRouter();
  const [items, setItems] = useState<PendingContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [types, setTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contact-inbox")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setItems(Array.isArray(d.pending) ? d.pending : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function act(id: string, action: "approve" | "reject", type?: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/contact-inbox/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "approve" ? JSON.stringify({ type: type || "other" }) : undefined,
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((p) => p.id !== id));
      if (action === "approve") router.refresh();
    } catch {
      // leave the item in place so the user can retry
    } finally {
      setBusy(null);
    }
  }

  if (loading || items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Inbox className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-medium text-white">
          New contacts from email <span className="text-amber-400">({items.length})</span>
        </h2>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        Found on emails BCC&apos;d to the CRM address with no matching contact. The conversation is already saved and will attach when you add them.
      </p>
      <div className="space-y-2">
        {items.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-900/60 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-white truncate">
                {p.name || p.email}
                {p.company && <span className="text-slate-500"> · {p.company}</span>}
              </p>
              <p className="text-[11px] text-slate-500 truncate">{p.email}</p>
              <p className="text-[10px] text-slate-600 truncate">Re: {p.subject}</p>
            </div>
            <select
              value={types[p.id] ?? "other"}
              onChange={(e) => setTypes((t) => ({ ...t, [p.id]: e.target.value }))}
              className="h-7 rounded border border-slate-700 bg-slate-800 px-1.5 text-[11px] text-white"
              aria-label="Contact type"
            >
              {CONTACT_TYPES.map((t) => (
                <option key={t} value={t}>{CONTACT_TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="h-7 bg-blue-600 hover:bg-blue-700 text-white"
              disabled={busy === p.id}
              onClick={() => act(p.id, "approve", types[p.id] ?? "other")}
            >
              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" />Add</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-slate-700 text-slate-400 hover:bg-slate-800"
              disabled={busy === p.id}
              onClick={() => act(p.id, "reject")}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
