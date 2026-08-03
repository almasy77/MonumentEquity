"use client";

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Separator } from "@/components/ui/separator";
import { EditableField } from "./editable-field";
import { Building2, AlertTriangle, Info } from "lucide-react";
import type { Deal } from "@/lib/validations";
import { computeTaxFlags } from "@/lib/tax-flags";

// Risk flags for the property-tax basis (abatement, reassessment gap, CAUV, land-use
// mismatch, reappraisal cycle). These warn a human; they never change the computed tax.
function TaxFlags({ deal }: { deal: Deal }) {
  const flags = computeTaxFlags(deal);
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {flags.map((f) => (
        <div
          key={f.id}
          className={`flex gap-1.5 rounded px-2 py-1 text-[10px] leading-snug ${
            f.severity === "warn" ? "bg-amber-500/10 text-amber-300" : "bg-slate-700/30 text-slate-400"
          }`}
        >
          {f.severity === "warn" ? <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> : <Info className="h-3 w-3 shrink-0 mt-0.5" />}
          <span>{f.text}</span>
        </div>
      ))}
    </div>
  );
}

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

// Live readout of the property-tax formula from the deal's tax fields:
//   assessed value = market value × (assessed % of market value)
//   property tax   = (mill rate / 1000) × (assessed % of mill rate) × assessed value
function TaxComputed({ deal }: { deal: Deal }) {
  const mill = deal.tax_mill_rate;
  const millAssessedPct = deal.tax_mill_assessed_pct ?? 100;
  const assessmentPct = deal.tax_assessment_pct;
  const market = deal.tax_market_value ?? deal.asking_price;
  if (mill == null || assessmentPct == null || !market) return null;
  const assessedValue = market * (assessmentPct / 100);
  const propertyTax = (mill / 1000) * (millAssessedPct / 100) * assessedValue;
  const effOnMarket = (mill / 1000) * (millAssessedPct / 100) * (assessmentPct / 100);
  return (
    <div className="mt-1 rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5 text-[11px] tabular-nums">
      <div className="flex justify-between text-slate-400">
        <span>Assessed Value</span>
        <span className="text-slate-200">{formatCurrency(assessedValue)}</span>
      </div>
      <div className="flex justify-between text-slate-400 mt-0.5">
        <span>Property Tax / yr</span>
        <span className="text-emerald-300 font-semibold">{formatCurrency(propertyTax)}</span>
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{(effOnMarket * 100).toFixed(3)}% of market value</div>
    </div>
  );
}

export function EditablePropertyDetails({ deal }: { deal: Deal }) {
  const router = useRouter();

  async function updateDeal(field: string, value: string) {
    let parsed: unknown = value;
    const numericFields = [
      "units", "year_built", "square_footage", "asking_price", "owner_acquisition_price",
      "tax_mill_rate", "tax_mill_assessed_pct", "tax_assessment_pct", "tax_market_value",
    ];
    if (numericFields.includes(field)) {
      parsed = value ? Number(value.replace(/,/g, "")) : undefined;
    }
    const boolFields = ["tax_abatement_present", "tax_cauv", "tax_reappraisal_in_progress"];
    if (boolFields.includes(field)) {
      parsed = value === "true" ? true : value === "false" ? undefined : value;
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
    // eslint-disable-next-line react-hooks/purity -- stable per mount, days granularity
    (Date.now() - new Date(deal.created_at).getTime()) / 86400000
  );

  return (
    <CollapsibleCard
      title="Property Details"
      icon={<Building2 className="h-4 w-4 text-blue-400" />}
    >
      <div className="space-y-3">
        {/* Key deal info — pricing and units */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Asking Price" value={deal.asking_price.toString()} onSave={(v) => updateDeal("asking_price", v)} type="number" prefix="$" />
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

        <Separator className="bg-slate-800" />

        {/* Core property info — horizontal layout */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Address" value={deal.address} onSave={(v) => updateDeal("address", v)} />
          <EditableField label="City" value={deal.city} onSave={(v) => updateDeal("city", v)} />
          <EditableField label="State" value={deal.state} onSave={(v) => updateDeal("state", v)} />
          <EditableField label="Zip" value={deal.zip || ""} onSave={(v) => updateDeal("zip", v)} placeholder="Enter zip" />
          <EditableField label="Source" value={deal.source} onSave={(v) => updateDeal("source", v)} />
          <EditableField label="Year Built" value={deal.year_built?.toString() || ""} onSave={(v) => updateDeal("year_built", v)} type="year" placeholder="e.g. 1985" />
          <EditableField label="Property Type" value={deal.property_type || ""} onSave={(v) => updateDeal("property_type", v)} placeholder="e.g. Multifamily" />
          <EditableField label="Square Footage" value={deal.square_footage?.toString() || ""} onSave={(v) => updateDeal("square_footage", v)} type="number" suffix=" SF" placeholder="Total SF" />
          <EditableField label="Lot Size" value={deal.lot_size || ""} onSave={(v) => updateDeal("lot_size", v)} placeholder="e.g. 0.45 acres" />
          <EditableField label="County" value={deal.county || ""} onSave={(v) => updateDeal("county", v)} placeholder="Enter county" />
          <EditableField label="Tax Parcel #" value={deal.parcel_number || ""} onSave={(v) => updateDeal("parcel_number", v)} placeholder="APN / Parcel number" />
          {/* Property tax basis (any market) — auto-populates the underwriting Tax Reassessment.
              property tax = (mill/1000) × (assessed % of mill) × (market × assessed % of market) */}
          <EditableField label="Mill Rate" value={deal.tax_mill_rate?.toString() || ""} onSave={(v) => updateDeal("tax_mill_rate", v)} type="number" suffix=" mills" placeholder="Mill rate, e.g. 75" />
          <EditableField label="Assessed % of Mill Rate" value={deal.tax_mill_assessed_pct?.toString() || ""} onSave={(v) => updateDeal("tax_mill_assessed_pct", v)} type="number" suffix="%" placeholder="100 if net, e.g. 65" />
          <EditableField label="Market Value" value={deal.tax_market_value?.toString() || ""} onSave={(v) => updateDeal("tax_market_value", v)} type="number" prefix="$" placeholder="County market/appraised value" />
          <EditableField label="Assessed % of Market Value" value={deal.tax_assessment_pct?.toString() || ""} onSave={(v) => updateDeal("tax_assessment_pct", v)} type="number" suffix="%" placeholder="Assessment ratio, e.g. 35" />
          <TaxComputed deal={deal} />
          <EditableField label="Land Use Code" value={deal.tax_land_use_code || ""} onSave={(v) => updateDeal("tax_land_use_code", v)} placeholder="e.g. 401 - APARTMENTS 4 TO 19 FAMILY" />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
            {([
              ["tax_abatement_present", "Abatement / exemption"],
              ["tax_cauv", "CAUV"],
              ["tax_reappraisal_in_progress", "Reappraisal in progress"],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!deal[field]}
                  onChange={(e) => updateDeal(field, e.target.checked ? "true" : "false")}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                />
                {label}
              </label>
            ))}
          </div>
          <TaxFlags deal={deal} />
          <EditableField label="County Site Address (alt)" value={deal.county_site_address || ""} onSave={(v) => updateDeal("county_site_address", v)} placeholder="If county indexes a different street" />
          <EditableField label="Tax Incentive" value={deal.incentive_type || ""} onSave={(v) => updateDeal("incentive_type", v)} placeholder="CRA / TIF / PILOT / LIHTC" />
          <EditableField label="Granting Authority" value={deal.granting_authority || ""} onSave={(v) => updateDeal("granting_authority", v)} placeholder="e.g. the City of Columbus" />
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
          {deal.tax_record_url && (
            <a href={deal.tax_record_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              View tax records
            </a>
          )}
        </div>

        <Separator className="bg-slate-800" />
        <EditableField label="Listing URL" value={deal.source_url || ""} onSave={(v) => updateDeal("source_url", v)} type="url" placeholder="Paste listing URL..." />
        <EditableField label="County Tax Records URL" value={deal.tax_record_url || ""} onSave={(v) => updateDeal("tax_record_url", v)} type="url" placeholder="Paste county tax assessor link..." />

        {/* Ownership — who holds title today (distinct from any "seller" contact) */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Ownership</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <EditableField label="Owner Entity" value={deal.owner_name || ""} onSave={(v) => updateDeal("owner_name", v)} placeholder="e.g. 3677 Indianola LLC" />
          <EditableField label="Owned Since" value={deal.owner_since || ""} onSave={(v) => updateDeal("owner_since", v)} type="date" placeholder="Acquisition date" />
          <EditableField label="Acquired For" value={deal.owner_acquisition_price?.toString() || ""} onSave={(v) => updateDeal("owner_acquisition_price", v)} type="number" prefix="$" placeholder="Price owner paid (county sale record)" />
          <EditableField label="Owner Mailing Address" value={deal.owner_mailing_address || ""} onSave={(v) => updateDeal("owner_mailing_address", v)} placeholder="Per county records" />
          <EditableField label="Ownership Notes" value={deal.owner_notes || ""} onSave={(v) => updateDeal("owner_notes", v)} placeholder="e.g. out-of-state owner" />
        </div>

        {/* Notes */}
        <Separator className="bg-slate-800" />
        <EditableField label="Notes" value={deal.market_notes || ""} onSave={(v) => updateDeal("market_notes", v)} placeholder="Add notes..." />

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
