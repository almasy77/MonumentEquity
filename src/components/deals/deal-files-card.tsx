"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Upload, Download, Trash2, Loader2, FileSpreadsheet, FileImage } from "lucide-react";
import { uploadFile } from "@/lib/upload-client";
import type { DealFile } from "@/lib/validations";

const KIND_LABELS: Record<DealFile["kind"], string> = {
  offering_memo: "OM",
  rent_roll: "Rent Roll",
  t12: "T12",
  other: "File",
};

const KIND_BADGE: Record<DealFile["kind"], string> = {
  offering_memo: "bg-blue-900/40 text-blue-200 border-blue-800",
  rent_roll: "bg-emerald-900/40 text-emerald-200 border-emerald-800",
  t12: "bg-amber-900/40 text-amber-200 border-amber-800",
  other: "bg-slate-800 text-slate-300 border-slate-700",
};

function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function FileIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />;
  }
  if (n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg")) {
    return <FileImage className="h-4 w-4 text-purple-400 shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-blue-400 shrink-0" />;
}

export function DealFilesCard({ dealId, files: initialFiles }: { dealId: string; files?: DealFile[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<DealFile[]>(initialFiles ?? []);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadFile(file, `/api/deals/${dealId}/files`, { kind: "other" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setFiles(data.files as DealFile[]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(fileId: string) {
    setDeletingId(fileId);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/files/${fileId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setFiles(data.files as DealFile[]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Files
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 h-8"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
            onChange={onPick}
            className="hidden"
          />
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        {files.length === 0 ? (
          <p className="text-sm text-slate-500">
            No files yet. Imported OM / rent roll / T12 documents are saved here automatically, or upload one directly.
          </p>
        ) : (
          <div className="space-y-1.5">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <FileIcon name={f.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 truncate" title={f.name}>{f.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${KIND_BADGE[f.kind]}`}>
                      {KIND_LABELS[f.kind]}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {[fmtSize(f.size), fmtDate(f.uploaded_at)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={f.name}
                  className="text-slate-400 hover:text-blue-400 p-1"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => onDelete(f.id)}
                  disabled={deletingId === f.id}
                  className="text-slate-500 hover:text-red-400 p-1 disabled:opacity-50"
                  title="Delete"
                >
                  {deletingId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
