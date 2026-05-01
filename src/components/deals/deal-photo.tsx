"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw, Loader2, X } from "lucide-react";
import { PhotoUploadModal } from "./photo-upload-modal";

interface DealPhotoProps {
  dealId: string;
  photos: string[] | undefined;
  sourceUrl: string | undefined;
}

export function DealPhoto({ dealId, photos }: Omit<DealPhotoProps, "sourceUrl">) {
  const router = useRouter();
  const [imgError, setImgError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const photoUrl = photos?.[0];

  if (!photoUrl || imgError) return null;

  return (
    <>
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
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 bg-black/60 hover:bg-black/80 text-white border-0"
            onClick={() => setUploadOpen(true)}
            title="Replace photo"
          >
            <Camera className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 bg-black/60 hover:bg-black/80 text-white border-0"
            onClick={async () => {
              await fetch(`/api/deals/${dealId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ photos: [] }),
              });
              router.refresh();
            }}
            title="Remove photo"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <PhotoUploadModal
        dealId={dealId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}

export function DealPhotoActions({ dealId, photos, sourceUrl }: DealPhotoProps) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const hasPhoto = photos && photos.length > 0;

  async function handleExtract() {
    if (!sourceUrl) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/extract-photo`, { method: "POST" });
      if (res.ok) router.refresh();
    } catch {
      // silent
    } finally {
      setExtracting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setUploadOpen(true)}
        className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
      >
        <Camera className="h-4 w-4" /> {hasPhoto ? "Replace Photo" : "Upload Photo"}
      </button>
      {sourceUrl && !hasPhoto && (
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
        >
          {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Extract Photo
        </button>
      )}
      <PhotoUploadModal
        dealId={dealId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
