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
    const numericFields = [
      "units", "year_built", "square_footage", "asking_price", "bid_price",
      "loi_amount", "earnest_money", "final_purchase_price", "loan_amount",
      "ltv", "interest_rate", "rate_spread", "loan_term_years", "amortization_years",
      "io_period_months", "origination_fee_rate", "dscr_requirement", "monthly_debt_service",
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

        {/* Seller-Provided Financials */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Seller / Broker Financials</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="Current NOI"
            value={deal.current_noi?.toString() || ""}
            onSave={(v) => updateDeal("current_noi", v)}
            type="number"
            prefix="$"
            placeholder="Annual NOI"
          />
          <EditableField
            label="Occupancy"
            value={deal.current_occupancy ? (deal.current_occupancy * 100).toFixed(1) : ""}
            onSave={(v) => updateDeal("current_occupancy", (Number(v) / 100).toString())}
            type="number"
            suffix="%"
            placeholder="e.g. 92"
          />
          <EditableField
            label="Annual Taxes"
            value={deal.current_annual_taxes?.toString() || ""}
            onSave={(v) => updateDeal("current_annual_taxes", v)}
            type="number"
            prefix="$"
            placeholder="Property taxes"
          />
          <EditableField
            label="Annual Insurance"
            value={deal.current_annual_insurance?.toString() || ""}
            onSave={(v) => updateDeal("current_annual_insurance", v)}
            type="number"
            prefix="$"
            placeholder="Insurance premium"
          />
        </div>

        {/* Financing */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Financing</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="Lender"
            value={deal.lender || ""}
            onSave={(v) => updateDeal("lender", v)}
            placeholder="e.g. Live Oak Bank"
          />
          <EditableField
            label="Loan Officer"
            value={deal.lender_contact || ""}
            onSave={(v) => updateDeal("lender_contact", v)}
            placeholder="Contact name"
          />
          <EditableField
            label="Loan Type"
            value={deal.loan_type || ""}
            onSave={(v) => updateDeal("loan_type", v)}
            placeholder="agency, bank, DSCR, bridge"
          />
          <EditableField
            label="Loan Status"
            value={deal.loan_status || ""}
            onSave={(v) => updateDeal("loan_status", v)}
            placeholder="shopping, term sheet, approved"
          />
          <EditableField
            label="Loan Amount"
            value={deal.loan_amount?.toString() || ""}
            onSave={(v) => updateDeal("loan_amount", v)}
            type="number"
            prefix="$"
            placeholder="Loan amount"
          />
          <EditableField
            label="LTV"
            value={deal.ltv ? (deal.ltv * 100).toFixed(1) : ""}
            onSave={(v) => updateDeal("ltv", (Number(v) / 100).toString())}
            type="number"
            suffix="%"
            placeholder="e.g. 75"
          />
          <EditableField
            label="Interest Rate"
            value={deal.interest_rate ? (deal.interest_rate * 100).toFixed(3) : ""}
            onSave={(v) => updateDeal("interest_rate", (Number(v) / 100).toString())}
            type="number"
            suffix="%"
            placeholder="e.g. 6.5"
          />
          <EditableField
            label="Rate Type"
            value={deal.rate_type || ""}
            onSave={(v) => updateDeal("rate_type", v)}
            placeholder="fixed, floating, hybrid"
          />
          <EditableField
            label="Loan Term (Years)"
            value={deal.loan_term_years?.toString() || ""}
            onSave={(v) => updateDeal("loan_term_years", v)}
            type="number"
            placeholder="e.g. 5"
          />
          <EditableField
            label="Amortization (Years)"
            value={deal.amortization_years?.toString() || ""}
            onSave={(v) => updateDeal("amortization_years", v)}
            type="number"
            placeholder="e.g. 30"
          />
          <EditableField
            label="IO Period (Months)"
            value={deal.io_period_months?.toString() || ""}
            onSave={(v) => updateDeal("io_period_months", v)}
            type="number"
            placeholder="0 if fully amortizing"
          />
          <EditableField
            label="Origination Fee"
            value={deal.origination_fee_rate ? (deal.origination_fee_rate * 100).toFixed(2) : ""}
            onSave={(v) => updateDeal("origination_fee_rate", (Number(v) / 100).toString())}
            type="number"
            suffix="%"
            placeholder="e.g. 1.0"
          />
          <EditableField
            label="DSCR Requirement"
            value={deal.dscr_requirement?.toString() || ""}
            onSave={(v) => updateDeal("dscr_requirement", v)}
            type="number"
            placeholder="e.g. 1.25"
          />
          <EditableField
            label="Prepayment"
            value={deal.prepayment_penalty || ""}
            onSave={(v) => updateDeal("prepayment_penalty", v)}
            placeholder="yield maint, defeasance, step-down, none"
          />
          <EditableField
            label="Term Sheet Date"
            value={deal.term_sheet_date || ""}
            onSave={(v) => updateDeal("term_sheet_date", v)}
            type="date"
          />
          <EditableField
            label="Monthly Debt Service"
            value={deal.monthly_debt_service?.toString() || ""}
            onSave={(v) => updateDeal("monthly_debt_service", v)}
            type="number"
            prefix="$"
            placeholder="P&I payment"
          />
        </div>
        {/* Quick financing summary */}
        {deal.loan_amount && deal.asking_price && (
          <div className="grid grid-cols-3 gap-3 text-xs mt-2">
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500">LTV</span>
              <p className="text-white font-medium">
                {((deal.loan_amount / (deal.final_purchase_price || deal.asking_price)) * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500">Equity Required</span>
              <p className="text-white font-medium">
                ${Math.round((deal.final_purchase_price || deal.asking_price) - deal.loan_amount).toLocaleString()}
              </p>
            </div>
            {deal.current_noi && deal.monthly_debt_service && (
              <div className="bg-slate-800 rounded p-2">
                <span className="text-slate-500">DSCR (current)</span>
                <p className="text-white font-medium">
                  {(deal.current_noi / (deal.monthly_debt_service * 12)).toFixed(2)}x
                </p>
              </div>
            )}
          </div>
        )}

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
            label="Final Purchase Price"
            value={deal.final_purchase_price?.toString() || ""}
            onSave={(v) => updateDeal("final_purchase_price", v)}
            type="number"
            prefix="$"
            placeholder="Agreed price"
          />
        </div>

        {/* Building Details */}
        <Separator className="bg-slate-800" />
        <h4 className="text-sm font-medium text-white">Building Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <EditableField
            label="Construction"
            value={deal.construction_type || ""}
            onSave={(v) => updateDeal("construction_type", v)}
            placeholder="wood frame, masonry, steel"
          />
          <EditableField
            label="Roof"
            value={deal.roof_type || ""}
            onSave={(v) => updateDeal("roof_type", v)}
            placeholder="shingle, flat, metal"
          />
          <EditableField
            label="HVAC"
            value={deal.hvac_type || ""}
            onSave={(v) => updateDeal("hvac_type", v)}
            placeholder="central, window, PTAC, mini-split"
          />
          <EditableField
            label="Laundry"
            value={deal.laundry_type || ""}
            onSave={(v) => updateDeal("laundry_type", v)}
            placeholder="in-unit, common area, none"
          />
          <EditableField
            label="Electrical"
            value={deal.electrical || ""}
            onSave={(v) => updateDeal("electrical", v)}
            placeholder="individual meters, master metered"
          />
          <EditableField
            label="Plumbing"
            value={deal.plumbing || ""}
            onSave={(v) => updateDeal("plumbing", v)}
            placeholder="copper, PEX, galvanized"
          />
          <EditableField
            label="Parking"
            value={deal.parking_type || ""}
            onSave={(v) => updateDeal("parking_type", v)}
            placeholder="surface, garage, street"
          />
          <EditableField
            label="Foundation"
            value={deal.foundation || ""}
            onSave={(v) => updateDeal("foundation", v)}
            placeholder="slab, crawl space, basement"
          />
        </div>
      </CardContent>
    </Card>
  );
}
