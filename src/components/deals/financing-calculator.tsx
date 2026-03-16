"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Save, Calculator } from "lucide-react";
import type { Deal } from "@/lib/validations";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function FieldInput({ label, value, onChange, prefix, suffix, readOnly = false, highlight = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <div className="flex items-center">
        {prefix && <span className="text-slate-500 text-sm mr-1">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          className={`bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm w-full outline-none focus:border-blue-500 ${
            readOnly
              ? highlight
                ? "text-green-400 font-semibold cursor-default"
                : "text-slate-400 cursor-default"
              : "text-white"
          }`}
          placeholder="0"
        />
        {suffix && <span className="text-slate-500 text-sm ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

export function FinancingCalculator({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Pre-populate from deal data
  const [bidPrice, setBidPrice] = useState(
    (deal.bid_price || deal.asking_price).toString()
  );
  const [downPct, setDownPct] = useState(
    deal.ltv ? ((1 - deal.ltv) * 100).toFixed(1) : "25"
  );
  const [rate, setRate] = useState(
    deal.interest_rate ? (deal.interest_rate * 100).toFixed(3) : ""
  );
  const [termMonths, setTermMonths] = useState(
    deal.loan_term_years ? (deal.loan_term_years * 12).toString() : "360"
  );

  const price = parseFloat(bidPrice) || 0;
  const downPaymentPct = parseFloat(downPct) || 0;
  const interestRate = parseFloat(rate) || 0;
  const term = parseInt(termMonths) || 360;

  const computed = useMemo(() => {
    const downPayment = price * (downPaymentPct / 100);
    const loanAmount = price - downPayment;
    const monthlyRate = interestRate / 100 / 12;

    let monthlyPayment = 0;
    if (monthlyRate > 0 && term > 0 && loanAmount > 0) {
      monthlyPayment =
        (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, term)) /
        (Math.pow(1 + monthlyRate, term) - 1);
    } else if (term > 0 && loanAmount > 0) {
      monthlyPayment = loanAmount / term;
    }

    return { downPayment, loanAmount, monthlyPayment };
  }, [price, downPaymentPct, interestRate, term]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        bid_price: price || undefined,
        ltv: downPaymentPct ? (100 - downPaymentPct) / 100 : undefined,
        loan_amount: computed.loanAmount || undefined,
        interest_rate: interestRate ? interestRate / 100 : undefined,
        loan_term_years: term ? term / 12 : undefined,
        monthly_debt_service: computed.monthlyPayment || undefined,
      };
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      title="Financing"
      icon={<Calculator className="h-4 w-4 text-blue-400" />}
      headerRight={
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Save className="h-3 w-3 mr-1" /> {saving ? "Saving..." : "Save"}
        </Button>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <FieldInput
          label="Bid Price"
          value={bidPrice}
          onChange={setBidPrice}
          prefix="$"
        />
        <FieldInput
          label="Down Payment"
          value={downPct}
          onChange={setDownPct}
          suffix="%"
        />
        <FieldInput
          label="Down Payment Amount"
          value={computed.downPayment ? computed.downPayment.toFixed(0) : "0"}
          onChange={() => {}}
          prefix="$"
          readOnly
        />
        <FieldInput
          label="Loan Amount"
          value={computed.loanAmount ? computed.loanAmount.toFixed(0) : "0"}
          onChange={() => {}}
          prefix="$"
          readOnly
        />
        <FieldInput
          label="Interest Rate"
          value={rate}
          onChange={setRate}
          suffix="%"
        />
        <FieldInput
          label="Term (months)"
          value={termMonths}
          onChange={setTermMonths}
        />
      </div>

      {/* Auto-calculated result */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
        <span className="text-sm text-slate-400">Monthly Payment (P&I)</span>
        <span className="text-lg font-bold text-green-400">
          {computed.monthlyPayment > 0 ? fmt(computed.monthlyPayment) : "—"}
        </span>
      </div>

      {/* Quick summary */}
      {computed.loanAmount > 0 && price > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">LTV</span>
            <p className="text-white font-medium">
              {((computed.loanAmount / price) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">Equity Required</span>
            <p className="text-white font-medium">{fmt(computed.downPayment)}</p>
          </div>
          {deal.current_noi && computed.monthlyPayment > 0 && (
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500">DSCR</span>
              <p className="text-white font-medium">
                {(deal.current_noi / (computed.monthlyPayment * 12)).toFixed(2)}x
              </p>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}
