"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Loader2, Trash2 } from "lucide-react";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  VENDOR_STATUSES,
  VENDOR_STATUS_LABELS,
  type Vendor,
  type VendorCategory,
  type VendorOffering,
  type VendorStatus,
} from "@/lib/vendors";

const inputCls = "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 text-sm";
const selectCls = "w-full h-9 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2";

function numOrNull(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));

interface OfferingDraft {
  id: string;
  name: string;
  price_from: string;
  price_notes: string;
  turnaround: string;
  max_purchase_price: string;
  max_renovation_spend: string;
  property_types: string;
  audit_protection_included: boolean;
  audit_protection_price: string;
  source_url: string;
  source_checked_date: string;
}

function toDraft(o: VendorOffering): OfferingDraft {
  return {
    id: o.id,
    name: o.name,
    price_from: numStr(o.price_from),
    price_notes: o.price_notes ?? "",
    turnaround: o.turnaround ?? "",
    max_purchase_price: numStr(o.max_purchase_price),
    max_renovation_spend: numStr(o.max_renovation_spend),
    property_types: o.property_types ?? "",
    audit_protection_included: o.audit_protection_included ?? false,
    audit_protection_price: numStr(o.audit_protection_price),
    source_url: o.source_url ?? "",
    source_checked_date: o.source_checked_date ?? "",
  };
}

function fromDraft(d: OfferingDraft): VendorOffering {
  const opt = (s: string) => (s.trim() === "" ? undefined : s.trim());
  return {
    id: d.id,
    name: d.name.trim(),
    price_from: numOrNull(d.price_from),
    price_notes: opt(d.price_notes),
    turnaround: opt(d.turnaround),
    max_purchase_price: numOrNull(d.max_purchase_price),
    max_renovation_spend: numOrNull(d.max_renovation_spend),
    property_types: opt(d.property_types),
    audit_protection_included: d.audit_protection_included,
    audit_protection_price: numOrNull(d.audit_protection_price),
    source_url: opt(d.source_url),
    source_checked_date: opt(d.source_checked_date),
  };
}

const emptyOffering = (): OfferingDraft =>
  toDraft({ id: crypto.randomUUID(), name: "" });

interface VendorFormDialogProps {
  vendor?: Vendor; // present → edit mode
}

export function VendorFormDialog({ vendor }: VendorFormDialogProps) {
  const router = useRouter();
  const editing = !!vendor;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const init = () => ({
    name: vendor?.name ?? "",
    company: vendor?.company ?? "",
    category: (vendor?.category ?? "cost_segregation") as VendorCategory,
    status: (vendor?.status ?? "untested") as VendorStatus,
    contact_name: vendor?.contact_name ?? "",
    phone: vendor?.phone ?? "",
    email: vendor?.email ?? "",
    website: vendor?.website ?? "",
    markets: (vendor?.markets ?? ["Nationwide"]).join(", "),
    stage_triggers: (vendor?.stage_triggers ?? []) as DealStage[],
    rating: vendor?.rating ? String(vendor.rating) : "",
    notes: vendor?.notes ?? "",
    offerings: (vendor?.offerings ?? []).map(toDraft),
  });
  const [f, setF] = useState(init);

  function setOffering(i: number, patch: Partial<OfferingDraft>) {
    setF((prev) => ({ ...prev, offerings: prev.offerings.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  }

  function toggleStage(s: DealStage) {
    setF((prev) => ({
      ...prev,
      stage_triggers: prev.stage_triggers.includes(s)
        ? prev.stage_triggers.filter((x) => x !== s)
        : [...prev.stage_triggers, s],
    }));
  }

  async function submit() {
    setError("");
    if (!f.name.trim()) { setError("Name is required"); return; }
    if (f.offerings.some((o) => !o.name.trim())) { setError("Every offering needs a name (or remove it)"); return; }
    const body = {
      name: f.name.trim(),
      company: f.company.trim() || undefined,
      category: f.category,
      status: f.status,
      contact_name: f.contact_name.trim() || undefined,
      phone: f.phone.trim() || undefined,
      email: f.email.trim() || undefined,
      website: f.website.trim() || undefined,
      contact_ids: vendor?.contact_ids,
      markets: f.markets.split(",").map((m) => m.trim()).filter(Boolean),
      stage_triggers: DEAL_STAGES.filter((s) => f.stage_triggers.includes(s)),
      rating: f.rating ? Number(f.rating) : null,
      notes: f.notes.trim() || undefined,
      offerings: f.offerings.map(fromDraft),
    };
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/vendors/${vendor!.id}` : "/api/vendors", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Save failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) { setF(init()); setError(""); }
      }}
    >
      <DialogTrigger
        render={
          editing
            ? <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:bg-slate-800" />
            : <Button className="bg-blue-600 hover:bg-blue-700 text-white" />
        }
      >
        {editing ? <><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</> : <><Plus className="h-4 w-4 mr-2" />Add Vendor</>}
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{editing ? `Edit ${vendor!.name}` : "Add Vendor"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Name *</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Company</Label>
              <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Category</Label>
              <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as VendorCategory })} className={selectCls}>
                {VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Status</Label>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as VendorStatus })} className={selectCls}>
                {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Contact name</Label>
              <Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Website</Label>
              <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Phone</Label>
              <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Email</Label>
              <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Markets (comma-separated)</Label>
              <Input value={f.markets} onChange={(e) => setF({ ...f, markets: e.target.value })} placeholder="Nationwide, Columbus OH" className={inputCls} />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Rating</Label>
              <select value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} className={selectCls}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r} / 5</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Suggest on deals at these stages</Label>
            <div className="flex flex-wrap gap-1.5">
              {DEAL_STAGES.map((s) => {
                const on = f.stage_triggers.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStage(s)}
                    className={`text-xs px-2 py-1 rounded border ${on ? "bg-blue-600/20 border-blue-500 text-blue-300" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Notes</Label>
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} className="bg-slate-800 border-slate-700 text-white text-sm" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300 text-xs">Offerings / tiers</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, offerings: [...f.offerings, emptyOffering()] })} className="border-slate-700 text-slate-300 hover:bg-slate-800 h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add offering
              </Button>
            </div>
            {f.offerings.length === 0 && <p className="text-xs text-slate-500">No offerings yet.</p>}
            {f.offerings.map((o, i) => (
              <div key={o.id} className="border border-slate-800 rounded-md p-3 space-y-2 bg-slate-950/40">
                <div className="flex gap-2">
                  <Input value={o.name} onChange={(e) => setOffering(i, { name: e.target.value })} placeholder="Offering name" className={inputCls} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, offerings: f.offerings.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400" aria-label="Remove offering">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Input value={o.price_from} onChange={(e) => setOffering(i, { price_from: e.target.value })} placeholder="Price from ($, blank = quote)" className={inputCls} />
                  <Input value={o.turnaround} onChange={(e) => setOffering(i, { turnaround: e.target.value })} placeholder="Turnaround" className={inputCls} />
                  <Input value={o.property_types} onChange={(e) => setOffering(i, { property_types: e.target.value })} placeholder="Property types" className={inputCls} />
                  <Input value={o.max_purchase_price} onChange={(e) => setOffering(i, { max_purchase_price: e.target.value })} placeholder="Max purchase price ($)" className={inputCls} />
                  <Input value={o.max_renovation_spend} onChange={(e) => setOffering(i, { max_renovation_spend: e.target.value })} placeholder="Max renovation ($)" className={inputCls} />
                  <Input value={o.audit_protection_price} onChange={(e) => setOffering(i, { audit_protection_price: e.target.value })} placeholder="Audit add-on ($)" className={inputCls} />
                </div>
                <Input value={o.price_notes} onChange={(e) => setOffering(i, { price_notes: e.target.value })} placeholder="Price notes" className={inputCls} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={o.source_url} onChange={(e) => setOffering(i, { source_url: e.target.value })} placeholder="Source URL" className={inputCls} />
                  <Input value={o.source_checked_date} onChange={(e) => setOffering(i, { source_checked_date: e.target.value })} placeholder="Checked (YYYY-MM-DD)" className={inputCls} />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={o.audit_protection_included} onChange={(e) => setOffering(i, { audit_protection_included: e.target.checked })} />
                  Audit protection included
                </label>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? "Save" : "Add Vendor"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
