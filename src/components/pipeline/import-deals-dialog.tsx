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
import { Upload, FileSpreadsheet, Download, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { ParseResult } from "@/lib/import-parser";

type Step = "upload" | "preview" | "importing" | "done";

export function ImportDealsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setLoading(false);
    setError("");
    setImportResult(null);
    setDragOver(false);
  }

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError("");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("mode", "preview");

      const res = await fetch("/api/deals/bulk-import", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to parse file");
      }

      const result: ParseResult = await res.json();
      setPreview(result);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleImport() {
    if (!file) return;
    setStep("importing");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "import");

      const res = await fetch("/api/deals/bulk-import", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }

      const result = await res.json();
      setImportResult({ imported: result.imported, skipped: result.skipped });
      setStep("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("preview");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:text-white" />
        }
      >
        <Upload className="h-4 w-4 mr-1.5" />
        Import
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {step === "upload" && "Import Properties from Spreadsheet"}
            {step === "preview" && "Review Import"}
            {step === "importing" && "Importing..."}
            {step === "done" && "Import Complete"}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 mt-2">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragOver ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-600"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <FileSpreadsheet className="h-10 w-10 text-slate-500 mx-auto mb-3" />
              <p className="text-sm text-slate-300 mb-1">
                Drag & drop a CSV or Excel file here
              </p>
              <p className="text-xs text-slate-500 mb-4">or</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Supports CSV and Excel (.xlsx) files
              </p>
              <button
                type="button"
                onClick={() => { window.location.href = "/api/deals/import-template"; }}
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <Download className="h-3 w-3" />
                Download Template
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Parsing file...
              </div>
            )}
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                {preview.valid_count} valid
              </div>
              {preview.error_count > 0 && (
                <div className="flex items-center gap-1.5 text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  {preview.error_count} with errors
                </div>
              )}
              <span className="text-slate-500">
                {preview.rows.length} total rows
              </span>
            </div>

            <div className="max-h-[400px] overflow-auto rounded border border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">Row</th>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">Status</th>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">Address</th>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">City</th>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">State</th>
                    <th className="px-2 py-1.5 text-right text-slate-400 font-medium">Units</th>
                    <th className="px-2 py-1.5 text-right text-slate-400 font-medium">Price</th>
                    <th className="px-2 py-1.5 text-left text-slate-400 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.row_number}
                      className={`border-t border-slate-800 ${row.valid ? "" : "bg-red-500/5"}`}
                    >
                      <td className="px-2 py-1.5 text-slate-500">{row.row_number}</td>
                      <td className="px-2 py-1.5">
                        {row.valid ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <span className="text-red-400" title={row.errors.join("; ")}>
                            <AlertCircle className="h-3.5 w-3.5 inline" />
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-300 max-w-[120px] truncate">
                        {row.data.address || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-slate-300">{row.data.city || "—"}</td>
                      <td className="px-2 py-1.5 text-slate-300">{row.data.state || "—"}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300">{row.data.units ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right text-slate-300">
                        {row.data.asking_price ? `$${row.data.asking_price.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-slate-300">{row.data.source || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.rows.some((r) => !r.valid) && (
              <div className="bg-slate-800/50 rounded p-3 space-y-1">
                <p className="text-xs font-medium text-slate-300">Row errors:</p>
                {preview.rows
                  .filter((r) => !r.valid)
                  .slice(0, 5)
                  .map((r) => (
                    <p key={r.row_number} className="text-xs text-red-400">
                      Row {r.row_number}: {r.errors.join(", ")}
                    </p>
                  ))}
                {preview.rows.filter((r) => !r.valid).length > 5 && (
                  <p className="text-xs text-slate-500">
                    ...and {preview.rows.filter((r) => !r.valid).length - 5} more
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleImport}
                disabled={preview.valid_count === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                Import {preview.valid_count} {preview.valid_count === 1 ? "Deal" : "Deals"}
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-400">Creating deals...</p>
          </div>
        )}

        {step === "done" && importResult && (
          <div className="space-y-4 mt-2">
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-lg font-medium text-white">
                {importResult.imported} {importResult.imported === 1 ? "deal" : "deals"} imported
              </p>
              {importResult.skipped > 0 && (
                <p className="text-sm text-slate-400">
                  {importResult.skipped} rows skipped due to errors
                </p>
              )}
            </div>
            <Button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
