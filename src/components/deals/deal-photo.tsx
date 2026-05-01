"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ImageIcon, RefreshCw, Loader2, X } from "lucide-react";

interface DealPhotoProps {
  dealId: string;
  photos: string[] | undefined;
  sourceUrl: string | undefined;
}

export function DealPhoto({ dealId, photos, sourceUrl }: DealPhotoProps) {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [imgError, setImgError] = useState(false);
  const photoUrl = photos?.[0];

  async function handleExtractPhoto() {
    if (!sourceUrl) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/extract-photo`, {
        method: "POST",
      });
      if (res.ok) {
        setImgError(false);
        router.refresh();
      }
    } catch {
      // Extraction failed silently
    } finally {
      setExtracting(false);
    }
  }

  async function handleRemovePhoto() {
    try {
      await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: [] }),
      });
      router.refresh();
    } catch {
      // Failed silently
    }
  }

  if (photoUrl && !imgError) {
    return (
      <div className="relative w-full h-48 md:h-64 rounded-lg overflow-hidden bg-slate-800 group">
        <Image
          src={photoUrl}
          alt="Property"
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 800px"
          onError={() => setImgError(true)}
          unoptimized
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {sourceUrl && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 bg-black/60 hover:bg-black/80 text-white border-0"
              onClick={handleExtractPhoto}
              disabled={extracting}
            >
              {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 bg-black/60 hover:bg-black/80 text-white border-0"
            onClick={handleRemovePhoto}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  if (!sourceUrl) return null;

  return (
    <button
      onClick={handleExtractPhoto}
      disabled={extracting}
      className="w-full h-24 rounded-lg border border-dashed border-slate-700 bg-slate-800/50 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors"
    >
      {extracting ? (
        <><Loader2 className="h-4 w-4 animate-spin" /> Extracting photo from listing...</>
      ) : (
        <><ImageIcon className="h-4 w-4" /> Extract photo from listing URL</>
      )}
    </button>
  );
}
