"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, ImageIcon } from "lucide-react";

const CARD_ASPECT = 300 / 112;

function cropToAspect(
  file: File,
  aspect: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      let sw = w;
      let sh = w / aspect;
      if (sh > h) {
        sh = h;
        sw = h * aspect;
      }
      const sx = (w - sw) / 2;
      const sy = (h - sh) / 2;

      const canvas = document.createElement("canvas");
      const maxW = Math.min(sw, 800);
      const scale = maxW / sw;
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

interface PhotoUploadModalProps {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

export function PhotoUploadModal({
  dealId,
  open,
  onOpenChange,
  onUploaded,
}: PhotoUploadModalProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setSelectedFile(null);
    setError("");
    setDragOver(false);
  }

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPEG, PNG)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }
    setError("");
    setSelectedFile(file);
    cropToAspect(file, CARD_ASPECT).then((blob) => {
      setPreview(URL.createObjectURL(blob));
    });
  }, []);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setError("");

    try {
      const cropped = await cropToAspect(selectedFile, CARD_ASPECT);
      const formData = new FormData();
      formData.append("file", cropped, "photo.jpg");

      const res = await fetch(`/api/deals/${dealId}/upload-photo`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      reset();
      onOpenChange(false);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Upload Property Photo</DialogTitle>
        </DialogHeader>

        {preview ? (
          <div className="space-y-4">
            <div className="relative w-full rounded-lg overflow-hidden bg-slate-800" style={{ aspectRatio: `${CARD_ASPECT}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            </div>
            <p className="text-xs text-slate-500 text-center">
              Auto-cropped to fit pipeline card
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                onClick={() => {
                  reset();
                  inputRef.current?.click();
                }}
                disabled={uploading}
              >
                Choose Different
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Photo"}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOver
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 hover:border-slate-600"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-slate-800 flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-slate-500" />
              </div>
              <div>
                <p className="text-sm text-slate-300">
                  Drop an image here or click to browse
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  JPEG or PNG, max 10MB
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <Upload className="h-4 w-4 mr-2" /> Choose File
              </Button>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
