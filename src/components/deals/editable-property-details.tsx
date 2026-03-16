"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EditableField } from "./editable-field";
import type { Deal } from "@/lib/validations";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function EditablePropertyDetails({ deal }: { deal: Deal }) {
  const router = useRouter();

  async function updateDeal(field: string, value: string) {
    let parsed: unknown = value;
    // Parse numeric fields
    if (["units", "year_built", "square_footage", "asking_price", "bid_price", "loi_amount", "earnest_money"].includes(field)) {
      parsed = value ? Number(value.replace(/,/g, "")) : undefined;
    }

    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    if (!res.ok) throw new Error("Failed to update");
    router.refresh();
  }

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`
  )}`;

  return (
    <Card className="bg-slate-900 border-slate-800 md:col-span-2">
      <CardHeader>
        <CardTitle className="text-white text-base">Property Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="Address"
            value={deal.address}
            onSave={(v) => updateDeal("address", v)}
          />
          <EditableField
            label="City"
            value={deal.city}
            onSave={(v) => updateDeal("city", v)}
          />
          <EditableField
            label="State"
            value={deal.state}
            onSave={(v) => updateDeal("state", v)}
          />
          <EditableField
            label="Zip"
            value={deal.zip || ""}
            onSave={(v) => updateDeal("zip", v)}
            placeholder="Enter zip"
          />
          <EditableField
            label="Source"
            value={deal.source}
            onSave={(v) => updateDeal("source", v)}
          />
          <EditableField
            label="Year Built"
            value={deal.year_built?.toString() || ""}
            onSave={(v) => updateDeal("year_built", v)}
            type="number"
            placeholder="e.g. 1985"
          />
          <EditableField
            label="Property Type"
            value={deal.property_type || ""}
            onSave={(v) => updateDeal("property_type", v)}
            placeholder="e.g. Multifamily"
          />
          <EditableField
            label="Square Footage"
            value={deal.square_footage?.toLocaleString() || ""}
            onSave={(v) => updateDeal("square_footage", v)}
            type="number"
            suffix=" SF"
            placeholder="Total SF"
          />
          <div>
            <span className="text-slate-500 text-xs">Created</span>
            <p className="text-slate-200 text-sm">{formatDate(deal.created_at)}</p>
          </div>
        </div>

        {/* Listing URL */}
        <Separator className="bg-slate-800" />
        <EditableField
          label="Listing URL"
          value={deal.source_url || ""}
          onSave={(v) => updateDeal("source_url", v)}
          type="url"
          placeholder="Paste listing URL..."
        />
        {deal.source_url && (
          <a
            href={deal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 underline"
          >
            View listing →
          </a>
        )}

        {/* Google Maps link */}
        <div>
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            📍 View on Google Maps →
          </a>
        </div>

        {/* Market Notes */}
        {deal.market_notes && (
          <>
            <Separator className="bg-slate-800" />
            <EditableField
              label="Market Notes"
              value={deal.market_notes}
              onSave={(v) => updateDeal("market_notes", v)}
              placeholder="Add market notes..."
            />
          </>
        )}
        {!deal.market_notes && (
          <>
            <Separator className="bg-slate-800" />
            <EditableField
              label="Market Notes"
              value=""
              onSave={(v) => updateDeal("market_notes", v)}
              placeholder="Add market notes..."
            />
          </>
        )}

        {/* LOI Details */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">LOI Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="LOI Amount"
            value={deal.loi_amount?.toString() || ""}
            onSave={(v) => updateDeal("loi_amount", v)}
            type="number"
            prefix="$"
            placeholder="Enter amount"
          />
          <EditableField
            label="LOI Date"
            value={deal.loi_date || ""}
            onSave={(v) => updateDeal("loi_date", v)}
            type="date"
            placeholder="YYYY-MM-DD"
          />
          <EditableField
            label="Earnest Money"
            value={deal.earnest_money?.toString() || ""}
            onSave={(v) => updateDeal("earnest_money", v)}
            type="number"
            prefix="$"
            placeholder="Enter amount"
          />
        </div>

        {/* DD & Closing */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Due Diligence & Closing</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="DD Start Date"
            value={deal.dd_start_date || ""}
            onSave={(v) => updateDeal("dd_start_date", v)}
            type="date"
          />
          <EditableField
            label="DD End Date"
            value={deal.dd_end_date || ""}
            onSave={(v) => updateDeal("dd_end_date", v)}
            type="date"
          />
          <EditableField
            label="Closing Date"
            value={deal.closing_date || ""}
            onSave={(v) => updateDeal("closing_date", v)}
            type="date"
          />
          <EditableField
            label="Lender"
            value={deal.lender || ""}
            onSave={(v) => updateDeal("lender", v)}
            placeholder="Lender name"
          />
        </div>
      </CardContent>
    </Card>
  );
}
