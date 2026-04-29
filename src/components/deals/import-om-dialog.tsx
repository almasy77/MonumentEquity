"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  Building2,
  DollarSign,
  Users,
  BarChart3,
  AlertTriangle,
  Phone,
  Mail,
} from "lucide-react";
import type { OMExtractedData } from "@/lib/om-extract";
import { uploadFile } from "@/lib/upload-client";

type Step = "upload" | "extracting" | "preview" | "saving" | "done";

interface DuplicateMatch {
  id: string;
  address: string;
  city: string;
  state: string;
  units: number;
}

type PreviewData = OMExtractedData & { duplicates?: DuplicateMatch[] };

function fmt(n: number | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

interface ImportOMDialogProps {
  dealId?: string;
  trigger?: React.ReactElement;
}

export function ImportOMDialog({ dealId, trigger }: ImportOMDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<PreviewData | null>(null);
  const [error, setError] = useState("");
  const [resultDealId, setResultDealId] = useState<string | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setStep("upload");
    setFile(null);
    setExtracted(null);
    setError("");
    setResultDealId(null);
    setMergeIntoId(null);
    setDragOver(false);
  }

  const targetDealId = dealId || mergeIntoId;

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError("");
    setStep("extracting");

    try {
      const res = await uploadFile(f, "/api/deals/import-om", { mode: "preview" });
      if (!res.ok) {
        let msg = "Failed to extract data";
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          if (res.status === 413) msg = "File too large. Try a smaller file or compress the PDF.";
          else msg = `Server error (${res.status}). Please try again.`;
        }
        throw new Error(msg);
      }

      const result: PreviewData = await res.json();
      setExtracted(result);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setStep("upload");
    }
  }, []);

  async function handleSave() {
    if (!file) return;
    setStep("saving");
    setError("");

    try {
      const extra: Record<string, string> = { mode: "save" };
      if (targetDealId) extra.deal_id = targetDealId;

      const res = await uploadFile(file, "/api/deals/import-om", extra);
      if (!res.ok) {
        let msg = "Failed to save";
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          if (res.status === 413) msg = "File too large. Try a smaller file or compress the PDF.";
          else msg = `Server error (${res.status}). Please try again.`;
        }
        throw new Error(msg);
      }

      const result = await res.json();
      setResultDealId(result.deal?.id);
      setStep("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStep("preview");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  const docTypeLabels: Record<string, string> = {
    offering_memo: "Offering Memorandum",
    rent_roll: "Rent Roll",
    t12: "T12 Operating Statement",
    other: "Document",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        render={
          trigger || (
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:text-white" />
          )
        }
      >
        {!trigger && (
          <>
            <FileText className="h-4 w-4 mr-1.5" />
            Import OM
          </>
        )}
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {step === "upload" && "Import Document"}
            {step === "extracting" && "Analyzing Document..."}
            {step === "preview" && `Review: ${extracted ? docTypeLabels[extracted.document_type] || "Document" : "Document"}`}
            {step === "saving" && "Saving..."}
            {step === "done" && "Import Complete"}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-slate-400">
              Upload an offering memo, rent roll, T12, or any real estate document.
              AI will extract all available data automatically.
            </p>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragOver ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-600"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <FileText className="h-10 w-10 text-slate-500 mx-auto mb-3" />
              <p className="text-sm text-slate-300 mb-1">
                Drag & drop a PDF here
              </p>
              <p className="text-xs text-slate-500 mb-4">Also supports PNG/JPG screenshots</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Browse Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
            <p className="text-xs text-slate-500">
              PDF up to 25MB. Images (PNG/JPG) up to 3.5MB — for larger scans, use PDF.
            </p>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {step === "extracting" && (
          <div className="flex flex-col items-center py-10 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <div className="text-center">
              <p className="text-sm text-white font-medium">Analyzing document...</p>
              <p className="text-xs text-slate-400 mt-1">
                Extracting property details, contacts, rent roll, T12 financials
              </p>
            </div>
            <p className="text-xs text-slate-500">This may take 15–30 seconds</p>
          </div>
        )}

        {step === "preview" && extracted && (
          <div className="space-y-4 mt-2">
            {/* Duplicate warning */}
            {!dealId && extracted.duplicates && extracted.duplicates.length > 0 && !mergeIntoId && (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-2 flex-1">
                    <p className="text-sm font-medium text-amber-300">
                      Possible duplicate — this address already exists in your pipeline:
                    </p>
                    {extracted.duplicates.map((dup) => (
                      <div key={dup.id} className="flex items-center justify-between bg-slate-800/50 rounded p-2">
                        <div className="text-sm">
                          <span className="text-white">{dup.address}</span>
                          <span className="text-slate-400 ml-2">{dup.city}, {dup.state} · {dup.units} units</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-amber-700 text-amber-300 hover:bg-amber-900/30 text-xs"
                          onClick={() => setMergeIntoId(dup.id)}
                        >
                          Merge Into This
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-slate-400">
                      Or scroll down to create a new deal anyway.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {mergeIntoId && (
              <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 flex items-center justify-between">
                <p className="text-sm text-blue-300">
                  Will merge into existing deal: <span className="text-white font-medium">{extracted.duplicates?.find((d) => d.id === mergeIntoId)?.address}</span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs text-slate-400"
                  onClick={() => setMergeIntoId(null)}
                >
                  Cancel
                </Button>
              </div>
            )}

            {/* Property Details */}
            <section className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-blue-400" />
                Property Details
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Field label="Address" value={extracted.property.address} />
                <Field label="City" value={extracted.property.city} />
                <Field label="State" value={extracted.property.state} />
                <Field label="ZIP" value={extracted.property.zip} />
                <Field label="Units" value={extracted.property.units?.toString()} />
                <Field label="Year Built" value={extracted.property.year_built?.toString()} />
                <Field label="Type" value={extracted.property.property_type} />
                <Field label="Sq Ft" value={extracted.property.square_footage?.toLocaleString()} />
                <Field label="Stories" value={extracted.property.stories?.toString()} />
                <Field label="Parking" value={extracted.property.parking_spaces?.toString()} />
                <Field label="Construction" value={extracted.property.construction_type} />
                <Field label="Roof" value={extracted.property.roof_type} />
                <Field label="HVAC" value={extracted.property.hvac_type} />
                <Field label="Laundry" value={extracted.property.laundry_type} />
                <Field label="Plumbing" value={extracted.property.plumbing} />
                <Field label="Foundation" value={extracted.property.foundation} />
              </div>
            </section>

            {/* Financials */}
            <section className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-green-400" />
                Financials
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Field label="Asking Price" value={fmt(extracted.financials.asking_price)} />
                <Field label="Current NOI" value={fmt(extracted.financials.current_noi)} />
                <Field label="Pro Forma NOI" value={fmt(extracted.financials.pro_forma_noi)} />
                <Field label="Occupancy" value={pct(extracted.financials.current_occupancy)} />
                <Field label="In-Place Cap" value={pct(extracted.financials.in_place_cap_rate)} />
                <Field label="Pro Forma Cap" value={pct(extracted.financials.pro_forma_cap_rate)} />
                <Field label="Annual Taxes" value={fmt(extracted.financials.current_annual_taxes)} />
                <Field label="Annual Insurance" value={fmt(extracted.financials.current_annual_insurance)} />
                <Field label="Assessed Value" value={fmt(extracted.financials.assessed_value)} />
                <Field label="GRM" value={extracted.financials.grm?.toFixed(1)} />
              </div>
            </section>

            {/* Contacts */}
            {extracted.contacts && extracted.contacts.length > 0 && (
              <section className="bg-slate-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <Users className="h-4 w-4 text-cyan-400" />
                  Contacts ({extracted.contacts.length})
                </h3>
                <div className="space-y-2">
                  {extracted.contacts.map((c, i) => (
                    <div key={i} className="flex items-start gap-3 bg-slate-800 rounded p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">{c.name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mt-0.5">
                          {c.company && <span>{c.company}</span>}
                          {c.title && <span>· {c.title}</span>}
                          {c.type && (
                            <span className="capitalize bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                              {c.type}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mt-1">
                          {c.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" /> {c.email}
                            </span>
                          )}
                          {c.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {c.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Rent Roll */}
            {extracted.rent_roll.length > 0 && (
              <section className="bg-slate-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  Rent Roll ({extracted.rent_roll.length} units)
                </h3>
                <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-slate-400">Unit</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Type</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Sq Ft</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Status</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Tenant</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Current</th>
                        <th className="px-2 py-1.5 text-right text-slate-400">Market</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Lease End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extracted.rent_roll.map((u, i) => (
                        <tr key={i} className="border-t border-slate-700/50">
                          <td className="px-2 py-1 text-white">{u.unit_number}</td>
                          <td className="px-2 py-1 text-slate-300">{u.unit_type || "—"}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{u.sqft?.toLocaleString() || "—"}</td>
                          <td className="px-2 py-1">
                            <span className={`text-xs ${u.status === "vacant" ? "text-red-400" : "text-green-400"}`}>
                              {u.status || "—"}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-slate-400 max-w-[80px] truncate">{u.tenant_name || "—"}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{u.current_rent ? `$${u.current_rent.toLocaleString()}` : "—"}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{u.market_rent ? `$${u.market_rent.toLocaleString()}` : "—"}</td>
                          <td className="px-2 py-1 text-slate-400">{u.lease_end || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* T12 */}
            {extracted.t12.months.length > 0 && (
              <section className="bg-slate-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-amber-400" />
                  T12 Operating Statement
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <Field label="Gross Income" value={fmt(extracted.t12.total_gpi)} />
                  <Field label="Effective Income" value={fmt(extracted.t12.total_egi)} />
                  <Field label="Total OpEx" value={fmt(extracted.t12.total_opex)} />
                  <Field label="NOI" value={fmt(extracted.t12.total_noi)} />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {extracted.t12.months.length} month{extracted.t12.months.length !== 1 ? "s" : ""} of data
                  {extracted.t12.period_start && extracted.t12.period_end && (
                    <span> ({extracted.t12.period_start} to {extracted.t12.period_end})</span>
                  )}
                </p>
              </section>
            )}

            {/* Notes */}
            {extracted.market_notes && (
              <section className="bg-slate-800/50 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-slate-400 mb-1">Market Notes</h3>
                <p className="text-sm text-slate-300">{extracted.market_notes}</p>
              </section>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Start Over
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {targetDealId ? "Merge Into Deal" : "Create Deal"}
              </Button>
            </div>
          </div>
        )}

        {step === "saving" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-400">{targetDealId ? "Merging into deal..." : "Creating deal..."}</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 mt-2">
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-lg font-medium text-white">
                {targetDealId ? "Deal updated" : "Deal created"}
              </p>
              {extracted && (
                <div className="text-sm text-slate-400 text-center space-y-0.5">
                  {extracted.rent_roll.length > 0 && <p>{extracted.rent_roll.length} units in rent roll</p>}
                  {extracted.t12.months.length > 0 && <p>{extracted.t12.months.length} months of T12 data</p>}
                  {extracted.contacts && extracted.contacts.length > 0 && <p>{extracted.contacts.length} contacts added</p>}
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpen(false); reset(); }}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Close
              </Button>
              {resultDealId && (
                <Button
                  type="button"
                  onClick={() => { router.push(`/deals/${resultDealId}`); setOpen(false); reset(); }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Go to Deal
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-xs text-slate-500">{label}</span>
      <p className="text-white">{value || "—"}</p>
    </div>
  );
}
