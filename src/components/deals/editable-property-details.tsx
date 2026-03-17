"use client";

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Separator } from "@/components/ui/separator";
import { EditableField } from "./editable-field";
import { Building2 } from "lucide-react";
import type { Deal } from "@/lib/validations";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

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
    const numericFields = [
      "units", "year_built", "square_footage", "asking_price", "bid_price",
      "loi_amount", "earnest_money", "final_purchase_price",
      "current_noi", "current_occupancy", "current_annual_taxes", "current_annual_insurance",
    ];
    if (numericFields.includes(field)) {
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

  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(deal.created_at).getTime()) / 86400000
  );
  const inPlaceCap = deal.current_noi && deal.asking_price > 0
    ? deal.current_noi / deal.asking_price
    : null;

  return (
    <CollapsibleCard
      title="Property Details"
      icon={<Building2 className="h-4 w-4 text-blue-400" />}
    >
      <div className="space-y-3">
        {/* Key Metrics — inline with property details */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <EditableField label="Asking Price" value={deal.asking_price.toString()} onSave={(v) => updateDeal("asking_price", v)} type="number" prefix="$" />
          <EditableField label="Bid Price" value={deal.bid_price?.toString() || ""} onSave={(v) => updateDeal("bid_price", v)} type="number" prefix="$" placeholder="Enter bid" />
          <EditableField label="Units" value={deal.units.toString()} onSave={(v) => updateDeal("units", v)} type="number" />
          <div>
            <span className="text-slate-500 text-xs">Price / Unit</span>
            <p className="text-slate-200 text-sm">{formatCurrency(pricePerUnit)}</p>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Days in Pipeline</span>
            <p className="text-slate-200 text-sm">{daysSinceCreated}</p>
          </div>
        </div>

        {/* Secondary metrics row */}
        {(inPlaceCap !== null || deal.current_noi || deal.loan_amount || deal.current_occupancy !== undefined) && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            {inPlaceCap !== null && (
              <div>
                <span className="text-slate-500 text-xs">In-Place Cap</span>
                <p className="text-slate-200 text-sm">{(inPlaceCap * 100).toFixed(2)}%</p>
              </div>
            )}
            {deal.current_noi && (
              <div>
                <span className="text-slate-500 text-xs">Current NOI</span>
                <p className="text-slate-200 text-sm">{formatCurrency(deal.current_noi)}</p>
              </div>
            )}
            {deal.current_occupancy !== undefined && deal.current_occupancy !== null && (
              <div>
                <span className="text-slate-500 text-xs">Occupancy</span>
                <p className="text-slate-200 text-sm">{(deal.current_occupancy * 100).toFixed(0)}%</p>
              </div>
            )}
            {deal.loan_amount && (
              <div>
                <span className="text-slate-500 text-xs">Loan Amount</span>
                <p className="text-slate-200 text-sm">{formatCurrency(deal.loan_amount)}</p>
              </div>
            )}
            {deal.monthly_debt_service && (
              <div>
                <span className="text-slate-500 text-xs">Monthly P&I</span>
                <p className="text-slate-200 text-sm">{formatCurrency(deal.monthly_debt_service)}</p>
              </div>
            )}
          </div>
        )}

        <Separator className="bg-slate-800" />

        {/* Core property info — horizontal layout */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Address" value={deal.address} onSave={(v) => updateDeal("address", v)} />
          <EditableField label="City" value={deal.city} onSave={(v) => updateDeal("city", v)} />
          <EditableField label="State" value={deal.state} onSave={(v) => updateDeal("state", v)} />
          <EditableField label="Zip" value={deal.zip || ""} onSave={(v) => updateDeal("zip", v)} placeholder="Enter zip" />
          <EditableField label="Source" value={deal.source} onSave={(v) => updateDeal("source", v)} />
          <EditableField label="Year Built" value={deal.year_built?.toString() || ""} onSave={(v) => updateDeal("year_built", v)} type="number" placeholder="e.g. 1985" />
          <EditableField label="Property Type" value={deal.property_type || ""} onSave={(v) => updateDeal("property_type", v)} placeholder="e.g. Multifamily" />
          <EditableField label="Square Footage" value={deal.square_footage?.toString() || ""} onSave={(v) => updateDeal("square_footage", v)} type="number" suffix=" SF" placeholder="Total SF" />
          <EditableField label="Lot Size" value={deal.lot_size || ""} onSave={(v) => updateDeal("lot_size", v)} placeholder="e.g. 0.45 acres" />
        </div>

        {/* Links row */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500">Created</span>
            <p className="text-slate-200 text-sm">{formatDate(deal.created_at)}</p>
          </div>
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
            View on Google Maps
          </a>
          {deal.source_url && (
            <a href={deal.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              View listing
            </a>
          )}
        </div>

        <Separator className="bg-slate-800" />
        <EditableField label="Listing URL" value={deal.source_url || ""} onSave={(v) => updateDeal("source_url", v)} type="url" placeholder="Paste listing URL..." />

        {/* Market Notes */}
        <Separator className="bg-slate-800" />
        <EditableField label="Market Notes" value={deal.market_notes || ""} onSave={(v) => updateDeal("market_notes", v)} placeholder="Add market notes..." />

        {/* LOI Details */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">LOI Details</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="LOI Amount" value={deal.loi_amount?.toString() || ""} onSave={(v) => updateDeal("loi_amount", v)} type="number" prefix="$" placeholder="Enter amount" />
          <EditableField label="LOI Date" value={deal.loi_date || ""} onSave={(v) => updateDeal("loi_date", v)} type="date" placeholder="YYYY-MM-DD" />
          <EditableField label="Earnest Money" value={deal.earnest_money?.toString() || ""} onSave={(v) => updateDeal("earnest_money", v)} type="number" prefix="$" placeholder="Enter amount" />
        </div>

        {/* Seller / Broker Financials */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Seller / Broker Financials</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Current NOI" value={deal.current_noi?.toString() || ""} onSave={(v) => updateDeal("current_noi", v)} type="number" prefix="$" placeholder="Annual NOI" />
          <EditableField label="Occupancy" value={deal.current_occupancy ? (deal.current_occupancy * 100).toFixed(1) : ""} onSave={(v) => updateDeal("current_occupancy", (Number(v) / 100).toString())} type="number" suffix="%" placeholder="e.g. 92" />
          <EditableField label="Annual Taxes" value={deal.current_annual_taxes?.toString() || ""} onSave={(v) => updateDeal("current_annual_taxes", v)} type="number" prefix="$" placeholder="Property taxes" />
          <EditableField label="Annual Insurance" value={deal.current_annual_insurance?.toString() || ""} onSave={(v) => updateDeal("current_annual_insurance", v)} type="number" prefix="$" placeholder="Insurance premium" />
          <EditableField label="Tax Records URL" value={deal.tax_record_url || ""} onSave={(v) => updateDeal("tax_record_url", v)} type="url" placeholder="County tax assessor link" />
        </div>
        {deal.tax_record_url && (
          <a href={deal.tax_record_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs inline-flex items-center gap-1">
            View Tax Records
          </a>
        )}

        {/* DD & Closing */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Due Diligence & Closing</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="DD Start Date" value={deal.dd_start_date || ""} onSave={(v) => updateDeal("dd_start_date", v)} type="date" />
          <EditableField label="DD End Date" value={deal.dd_end_date || ""} onSave={(v) => updateDeal("dd_end_date", v)} type="date" />
          <EditableField label="Closing Date" value={deal.closing_date || ""} onSave={(v) => updateDeal("closing_date", v)} type="date" />
          <EditableField label="Final Purchase Price" value={deal.final_purchase_price?.toString() || ""} onSave={(v) => updateDeal("final_purchase_price", v)} type="number" prefix="$" placeholder="Agreed price" />
        </div>

        {/* Building Details */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Building Details</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Construction" value={deal.construction_type || ""} onSave={(v) => updateDeal("construction_type", v)} placeholder="wood frame, masonry, steel" />
          <EditableField label="Roof" value={deal.roof_type || ""} onSave={(v) => updateDeal("roof_type", v)} placeholder="shingle, flat, metal" />
          <EditableField label="HVAC" value={deal.hvac_type || ""} onSave={(v) => updateDeal("hvac_type", v)} placeholder="central, window, PTAC, mini-split" />
          <EditableField label="Laundry" value={deal.laundry_type || ""} onSave={(v) => updateDeal("laundry_type", v)} placeholder="in-unit, common area, none" />
          <EditableField label="Electrical" value={deal.electrical || ""} onSave={(v) => updateDeal("electrical", v)} placeholder="individual meters, master metered" />
          <EditableField label="Plumbing" value={deal.plumbing || ""} onSave={(v) => updateDeal("plumbing", v)} placeholder="copper, PEX, galvanized" />
          <EditableField label="Parking" value={deal.parking_type || ""} onSave={(v) => updateDeal("parking_type", v)} placeholder="surface, garage, street" />
          <EditableField label="Foundation" value={deal.foundation || ""} onSave={(v) => updateDeal("foundation", v)} placeholder="slab, crawl space, basement" />
        </div>
      </div>
    </CollapsibleCard>
  );
}
