"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Receipt,
  Loader2,
  CheckCircle2,
  Calculator,
  AlertTriangle,
} from "lucide-react";

type Step = "input" | "extracting" | "review" | "saving" | "done";

interface TaxPatch {
  tax_mill_rate?: number;
  tax_mill_assessed_pct?: number;
  tax_assessment_pct?: number;
  tax_market_value?: number;
  assessed_value?: number;
  current_annual_taxes?: number;
  tax_year?: number;
}

interface ExtractedTaxRecord {
  parcel_id?: string;
  tax_year?: number;
  net_annual_tax?: number;
  taxable_value_total?: number;
  appraised_value_total?: number;
  stated_mill_rate?: number;
  land_use_code?: string;
  has_abatement?: boolean;
  abatement_notes?: string;
}

interface ImportResult {
  patch: TaxPatch;
  reconciled_tax: number | null;
  extracted: ExtractedTaxRecord;
  notes: string;
}

function money(n: number | undefined | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function num(n: number | undefined | null, suffix = ""): string {
  if (n == null) return "—";
  return `${n.toLocaleString()}${suffix}`;
}

interface TaxImportDialogProps {
  dealId: string;
  trigger?: React.ReactElement;
}

export function TaxImportDialog({ dealId, trigger }: TaxImportDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  function reset() {
    setStep("input");
    setText("");
    setResult(null);
    setError("");
  }

  async function handleExtract() {
    if (!text.trim()) return;
    setStep("extracting");
    setError("");
    try {
      const res = await fetch(`/api/deals/${dealId}/import-tax`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        let msg = "Failed to extract tax record";
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          msg = `Server error (${res.status}). Please try again.`;
        }
        throw new Error(msg);
      }
      const data: ImportResult = await res.json();
      setResult(data);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setStep("input");
    }
  }

  async function handleSave() {
    if (!result) return;
    setStep("saving");
    setError("");
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.patch),
      });
      if (!res.ok) {
        let msg = "Failed to save to deal";
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          msg = `Server error (${res.status}). Please try again.`;
        }
        throw new Error(msg);
      }
      setStep("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStep("review");
    }
  }

  const ex = result?.extracted;
  const p = result?.patch;

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
            <Receipt className="h-4 w-4 mr-1.5" />
            Import Tax Record
          </>
        )}
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {step === "input" && "Import Tax Record"}
            {step === "extracting" && "Reading Tax Record..."}
            {step === "review" && "Review Extracted Taxes"}
            {step === "saving" && "Saving..."}
            {step === "done" && "Taxes Imported"}
          </DialogTitle>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-slate-400">
              Paste the raw text of a county tax / auditor record (e.g. a Franklin
              County Auditor &ldquo;Printable Page&rdquo;, or any US county assessor page
              or PDF text). AI will extract the tax figures and derive a clean,
              self-consistent mill-rate basis for this deal.
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the county tax record text here…"
              className="min-h-[220px] bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600 font-mono text-xs"
            />
            <div className="flex items-center justify-between">
              <span className={`text-xs ${text.length > 20000 ? "text-red-400" : "text-slate-500"}`}>
                {text.length.toLocaleString()} / 20,000 characters
              </span>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                onClick={handleExtract}
                disabled={!text.trim() || text.length > 20000}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                <Calculator className="h-4 w-4 mr-1.5" />
                Extract
              </Button>
            </div>
          </div>
        )}

        {step === "extracting" && (
          <div className="flex flex-col items-center py-10 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <div className="text-center">
              <p className="text-sm text-white font-medium">Reading tax record...</p>
              <p className="text-xs text-slate-400 mt-1">
                Extracting Net Annual Tax, Taxable Value, Appraised Value, and deriving mills
              </p>
            </div>
          </div>
        )}

        {step === "review" && result && (
          <div className="space-y-4 mt-2">
            {/* Extracted from record */}
            <section className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Receipt className="h-4 w-4 text-cyan-400" />
                From the Record
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Field label="Parcel ID" value={ex?.parcel_id || "—"} />
                <Field label="Tax Year" value={ex?.tax_year ? String(ex.tax_year) : "—"} />
                <Field label="Net Annual Tax" value={money(ex?.net_annual_tax)} />
                <Field label="Taxable Value" value={money(ex?.taxable_value_total)} />
                <Field label="Appraised Value" value={money(ex?.appraised_value_total)} />
                <Field label="Stated Mill Rate" value={num(ex?.stated_mill_rate)} />
                <Field label="Land Use" value={ex?.land_use_code || "—"} />
              </div>
              {ex?.has_abatement && (
                <div className="mt-3 flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded p-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    Abatement / exemption indicated
                    {ex.abatement_notes ? `: ${ex.abatement_notes}` : ""}
                  </p>
                </div>
              )}
            </section>

            {/* Derived deal fields */}
            <section className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4 text-green-400" />
                Derived Deal Fields
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Field label="Mill Rate" value={num(p?.tax_mill_rate)} />
                <Field label="Assessed % of Mill" value={num(p?.tax_mill_assessed_pct, "%")} />
                <Field label="Assessed % of Market" value={num(p?.tax_assessment_pct, "%")} />
                <Field label="Tax Market Value" value={money(p?.tax_market_value)} />
                <Field label="Assessed Value" value={money(p?.assessed_value)} />
                <Field label="Current Annual Taxes" value={money(p?.current_annual_taxes)} />
              </div>
              <div className="mt-3 flex items-center gap-2 bg-green-900/20 border border-green-700/40 rounded p-2.5">
                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                <p className="text-xs text-green-300">
                  Reconciled property tax:{" "}
                  <span className="font-semibold text-white">{money(result.reconciled_tax)}</span>
                  {ex?.net_annual_tax != null && (
                    <span className="text-slate-400"> (record: {money(ex.net_annual_tax)})</span>
                  )}
                </p>
              </div>
            </section>

            {result.notes && (
              <section className="bg-slate-800/50 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-slate-400 mb-1">Notes</h3>
                <p className="text-sm text-slate-300">{result.notes}</p>
              </section>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
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
                Save to Deal
              </Button>
            </div>
          </div>
        )}

        {step === "saving" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-400">Saving taxes to deal...</p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center py-8 gap-4">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-lg font-medium text-white">Taxes saved to deal</p>
            <Button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Close
            </Button>
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
