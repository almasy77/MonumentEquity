"use client";

import { useEffect, useState } from "react";
import { Mail, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { EmailLog } from "@/lib/validations";

/**
 * Correspondence timeline for a contact — the emails BCC'd to the CRM address and
 * attached to this contact. Lazy-loads when shown.
 */
export function ContactCorrespondence({ contactId }: { contactId: string }) {
  const [emails, setEmails] = useState<EmailLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contacts/${contactId}/emails`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEmails(Array.isArray(d.emails) ? d.emails : []); })
      .catch(() => { if (!cancelled) setEmails([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contactId]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="border-t border-slate-800 pt-3">
      <div className="flex items-center gap-2 mb-2">
        <Mail className="h-4 w-4 text-blue-400" />
        <h4 className="text-sm font-medium text-white">Correspondence</h4>
        {emails && emails.length > 0 && (
          <span className="text-[11px] text-slate-500">({emails.length})</span>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
      )}

      {!loading && emails && emails.length === 0 && (
        <p className="text-[11px] text-slate-500">
          No logged emails yet. BCC the CRM address on a thread with this contact and it will appear here.
        </p>
      )}

      {!loading && emails && emails.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-auto">
          {emails.map((e) => {
            const isOpen = openId === e.id;
            return (
              <div key={e.id} className="rounded border border-slate-800 bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : e.id)}
                  className="w-full flex items-start gap-2 px-2.5 py-1.5 text-left"
                >
                  {isOpen ? <ChevronDown className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-white truncate">{e.subject}</span>
                      <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{fmt(e.sent_at)}</span>
                    </span>
                    <span className="block text-[10px] text-slate-500 truncate">
                      {e.from_name ? `${e.from_name} <${e.from}>` : e.from}
                    </span>
                    {!isOpen && e.snippet && (
                      <span className="block text-[11px] text-slate-400 truncate">{e.snippet}</span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-2 pt-0.5 text-[11px] leading-relaxed">
                    <div className="text-slate-500 mb-1">
                      {e.to.length > 0 && <div className="truncate">To: {e.to.join(", ")}</div>}
                      {e.cc.length > 0 && <div className="truncate">Cc: {e.cc.join(", ")}</div>}
                      {e.attachments.length > 0 && (
                        <div>{e.attachments.length} attachment{e.attachments.length > 1 ? "s" : ""}: {e.attachments.map((a) => a.name).join(", ")}</div>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-slate-300 max-h-60 overflow-auto">{e.text_body || "(no text body)"}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
