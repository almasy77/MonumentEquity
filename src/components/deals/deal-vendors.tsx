"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Briefcase, Loader2, X, Send } from "lucide-react";
import { STAGE_LABELS, type DealStage } from "@/lib/constants";
import {
  DEAL_VENDOR_STATUSES,
  DEAL_VENDOR_STATUS_LABELS,
  VENDOR_CATEGORY_LABELS,
  offeringEligibility,
  suggestedVendorsForStage,
  type DealVendor,
  type DealVendorStatus,
  type Vendor,
  type VendorOffering,
} from "@/lib/vendors";

const usd = (n: number | null | undefined) => (typeof n === "number" ? `$${Math.round(n).toLocaleString("en-US")}` : "—");
const selectCls = "h-8 rounded-md bg-slate-800 border border-slate-700 text-white text-xs px-2";

const VERDICT_TONE = {
  eligible: "bg-emerald-500/15 text-emerald-300",
  ineligible: "bg-red-500/15 text-red-300",
  unknown: "bg-amber-500/15 text-amber-300",
} as const;

interface DealVendorsProps {
  dealId: string;
  stage: DealStage;
  vendors: Vendor[];
  links: DealVendor[];
  purchasePrice: number | null;
  purchasePriceSource: string;
  renovationSpend: number | null;
  renovationSource: string;
}

export function DealVendors({
  dealId,
  stage,
  vendors,
  links: initialLinks,
  purchasePrice,
  purchasePriceSource,
  renovationSpend,
  renovationSource,
}: DealVendorsProps) {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [addVendorId, setAddVendorId] = useState("");

  const byId = new Map(vendors.map((v) => [v.id, v]));
  const linkedIds = links.map((l) => l.vendor_id);
  const suggested = suggestedVendorsForStage(vendors, stage, linkedIds);
  const others = vendors
    .filter((v) => !linkedIds.includes(v.id) && v.status !== "do_not_use")
    .sort((a, b) => a.name.localeCompare(b.name));

  async function requestQuote(vendorId: string, offeringId?: string) {
    setError("");
    setBusy(`req:${vendorId}:${offeringId ?? ""}`);
    try {
      const res = await fetch(`/api/deals/${dealId}/vendors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: vendorId, offering_id: offeringId, status: "requested" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not link vendor"); return; }
      setLinks((prev) => [data as DealVendor, ...prev]);
      setAddVendorId("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function updateLink(link: DealVendor, patch: Partial<DealVendor>) {
    setError("");
    const optimistic = { ...link, ...patch };
    setLinks((prev) => prev.map((l) => (l.id === link.id ? optimistic : l)));
    const res = await fetch(`/api/deals/${dealId}/vendors/${link.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Update failed");
      setLinks((prev) => prev.map((l) => (l.id === link.id ? link : l)));
    }
  }

  async function unlink(link: DealVendor) {
    setBusy(`del:${link.id}`);
    const res = await fetch(`/api/deals/${dealId}/vendors/${link.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) setLinks((prev) => prev.filter((l) => l.id !== link.id));
  }

  function eligibilityChip(offering: VendorOffering) {
    const e = offeringEligibility(offering, { purchasePrice, renovationSpend });
    const label = e.verdict === "eligible" ? "Eligible" : e.verdict === "ineligible" ? "Not eligible" : "Check";
    return (
      <span title={e.reasons.join("; ") || "No price or renovation cap"} className={`text-[10px] px-1.5 py-0.5 rounded ${VERDICT_TONE[e.verdict]}`}>
        {label}
      </span>
    );
  }

  return (
    <CollapsibleCard
      title="Vendors"
      icon={<Briefcase className="h-4 w-4 text-slate-400" />}
      headerRight={<Link href="/vendors" className="text-xs text-blue-400 hover:underline">Directory</Link>}
    >
      <div className="space-y-5">
        <p className="text-[11px] text-slate-500">
          Eligibility uses purchase price {usd(purchasePrice)} ({purchasePriceSource}) and renovation {usd(renovationSpend)} ({renovationSource}).
        </p>

        {/* Linked vendors */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">On this deal</h4>
          {links.length === 0 && <p className="text-sm text-slate-500">No vendors linked yet.</p>}
          {links.map((l) => {
            const v = byId.get(l.vendor_id);
            return (
              <div key={l.id} className="border border-slate-800 rounded-md p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {v ? <Link href={`/vendors/${v.id}`} className="text-sm text-white hover:text-blue-400 truncate block">{v.name}</Link> : <span className="text-sm text-slate-500">Vendor removed</span>}
                    {v && <span className="text-[11px] text-slate-500">{VENDOR_CATEGORY_LABELS[v.category]}</span>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => unlink(l)} disabled={busy === `del:${l.id}`} className="text-slate-500 hover:text-red-400 h-7 w-7 p-0" aria-label="Remove vendor from deal">
                    {busy === `del:${l.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <select
                    value={l.offering_id ?? ""}
                    onChange={(e) => updateLink(l, { offering_id: e.target.value || undefined })}
                    className={selectCls}
                    aria-label="Offering"
                  >
                    <option value="">Offering…</option>
                    {(v?.offerings ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <select
                    value={l.status}
                    onChange={(e) => updateLink(l, { status: e.target.value as DealVendorStatus })}
                    className={selectCls}
                    aria-label="Status"
                  >
                    {DEAL_VENDOR_STATUSES.map((s) => <option key={s} value={s}>{DEAL_VENDOR_STATUS_LABELS[s]}</option>)}
                  </select>
                  <Input
                    defaultValue={l.quote_amount ?? ""}
                    placeholder="Quote $"
                    inputMode="decimal"
                    onBlur={(e) => {
                      const raw = e.target.value.replace(/[$,\s]/g, "");
                      const n = raw === "" ? null : Number(raw);
                      if (n !== null && (!Number.isFinite(n) || n < 0)) return;
                      if (n !== (l.quote_amount ?? null)) updateLink(l, { quote_amount: n });
                    }}
                    className="h-8 bg-slate-800 border-slate-700 text-white text-xs"
                  />
                  <Input
                    type="date"
                    defaultValue={l.quote_date ?? ""}
                    onBlur={(e) => { if (e.target.value !== (l.quote_date ?? "")) updateLink(l, { quote_date: e.target.value || undefined }); }}
                    className="h-8 bg-slate-800 border-slate-700 text-white text-xs"
                    aria-label="Quote date"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Suggested for the current stage */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Suggested for {STAGE_LABELS[stage]}
          </h4>
          {suggested.length === 0 && <p className="text-sm text-slate-500">No vendors are set to surface at this stage.</p>}
          {suggested.map((v) => (
            <div key={v.id} className="border border-slate-800 rounded-md p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <Link href={`/vendors/${v.id}`} className="text-sm text-white hover:text-blue-400">{v.name}</Link>
                <span className="text-[11px] text-slate-500">{VENDOR_CATEGORY_LABELS[v.category]}</span>
              </div>
              <div className="space-y-1">
                {(v.offerings.length > 0 ? v.offerings : [null]).map((o) => {
                  const key = `req:${v.id}:${o?.id ?? ""}`;
                  return (
                    <div key={o?.id ?? "none"} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-300 truncate">{o ? o.name : "General"}</span>
                        {o && <span className="text-slate-500 whitespace-nowrap">{o.price_from == null ? "quote" : `from ${usd(o.price_from)}`}</span>}
                        {o && eligibilityChip(o)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => requestQuote(v.id, o?.id)}
                        disabled={busy !== null}
                        className="h-7 text-[11px] border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0"
                      >
                        {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        <span className="ml-1">Request quote</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Link any other vendor */}
        {others.length > 0 && (
          <div className="flex gap-2 items-center">
            <select value={addVendorId} onChange={(e) => setAddVendorId(e.target.value)} className={`${selectCls} flex-1`} aria-label="Add another vendor">
              <option value="">Add another vendor…</option>
              {others.map((v) => <option key={v.id} value={v.id}>{v.name} · {VENDOR_CATEGORY_LABELS[v.category]}</option>)}
            </select>
            <Button
              size="sm"
              onClick={() => addVendorId && requestQuote(addVendorId)}
              disabled={!addVendorId || busy !== null}
              className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs"
            >
              Link
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </CollapsibleCard>
  );
}
