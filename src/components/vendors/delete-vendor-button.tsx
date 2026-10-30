"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";

/** Two-click delete (no browser confirm dialog): first click arms, second deletes. */
export function DeleteVendorButton({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setBusy(true);
    const res = await fetch(`/api/vendors/${vendorId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { router.push("/vendors"); router.refresh(); }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={busy}
      title={`Delete ${vendorName}`}
      className={armed ? "border-red-600 text-red-400 hover:bg-red-950" : "border-slate-700 text-slate-400 hover:bg-slate-800"}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      <span className="ml-1.5">{armed ? "Confirm delete" : "Delete"}</span>
    </Button>
  );
}
