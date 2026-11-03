"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Landmark, Check, AlertTriangle } from "lucide-react";
import type { AttomLoan } from "@/lib/attom";

interface Props {
  dealId: string;
  /** Market/asking value used to show implied equity against the estimated balance. */
  valueBasis?: number;
  savedBalanceEst?: number;
  onSaveBalance: (value: string) => Promise<void> | void;
}

interface ApiResult {
  configured?: boolean;
  cached?: boolean;
  not_found?: boolean;
  message?: string;
  error?: string;
  address?: string;
  loans?: AttomLoan[];
  totalEstimatedBalance?: number;
  fetchedAt?: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function LoanRow({ loan }: { loan: AttomLoan }) {
  const pos = loan.position === "first" ? "1st" : loan.position === "second" ? "2nd" : "—";
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 px-2.5 py-1.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-slate-300 font-medium">{pos} lien{loan.lender ? ` · ${loan.lender}` : ""}</span>
        {loan.loanType && <span className="text-slate-500">{loan.loanType}</span>}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-400 tabular-nums">
        {loan.originalAmount != null && <div className="flex justify-between"><span>Original</span><span className="text-slate-200">{money(loan.originalAmount)}</span></div>}
        {loan.interestRate != null && <div className="flex justify-between"><span>Rate</span><span className="text-slate-200">{pct(loan.interestRate)}</span></div>}
        {loan.originationDate && <div className="flex justify-between"><span>Recorded</span><span className="text-slate-200">{loan.originationDate}</span></div>}
        {loan.termMonths != null && <div className="flex justify-between"><span>Term</span><span className="text-slate-200">{Math.round(loan.termMonths / 12)} yr</span></div>}
      </div>
      {loan.estimatedBalance != null ? (
        <div className="mt-1 flex justify-between text-[11px] tabular-nums">
          <span className="text-slate-400">Est. balance today</span>
          <span className="text-cyan-300 font-semibold">{money(loan.estimatedBalance)}</span>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-amber-400/80">{loan.estimateNote ?? "No payoff estimate available."}</p>
      )}
    </div>
  );
}

export function AttomMortgagePanel({ dealId, valueBasis, savedBalanceEst, onSaveBalance }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [saved, setSaved] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/attom-mortgage${refresh ? "?refresh=1" : ""}`);
      setResult(await res.json());
      setOpen(true);
    } catch {
      setResult({ error: "Request failed" });
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  const total = result?.totalEstimatedBalance;
  const impliedEquity = total != null && valueBasis ? valueBasis - total : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-slate-700 text-cyan-400 hover:bg-slate-800"
          disabled={loading}
          onClick={() => (open ? load(true) : load(false))}
        >
          <Landmark className="h-3 w-3 mr-1" />
          {loading ? "Looking up…" : open ? "Refresh" : "Look up existing mortgage (ATTOM)"}
        </Button>
        {savedBalanceEst != null && (
          <span className="text-[11px] text-slate-400 tabular-nums">
            Saved est. balance: <span className="text-slate-200">{money(savedBalanceEst)}</span>
          </span>
        )}
      </div>

      {open && result && (
        <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
          {result.configured === false && <p className="text-[11px] text-amber-400/90">Add ATTOM_API_KEY to enable deed / mortgage lookups.</p>}
          {result.error && <p className="text-[11px] text-red-400">{result.error}</p>}
          {result.not_found && <p className="text-[11px] text-slate-500">No recorded mortgage found for this address (free-and-clear, or not in ATTOM&apos;s records).</p>}

          {result.loans && result.loans.length > 0 && (
            <>
              <div className="flex items-start gap-1.5 mb-2 rounded bg-amber-500/10 px-2 py-1 text-[10px] leading-snug text-amber-300">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>Estimated, not a live payoff. ATTOM reports the <em>recorded</em> loan; the balance is a straight amortization from origination to today and ignores extra principal, refis, HELOC draws and modifications. Verify with a payoff statement before relying on it.</span>
              </div>

              <div className="space-y-1.5">
                {result.loans.map((loan, i) => <LoanRow key={i} loan={loan} />)}
              </div>

              {total != null && (
                <div className="mt-2 rounded border border-slate-700 bg-slate-800/40 px-2.5 py-1.5 text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total est. outstanding</span>
                    <span className="text-cyan-300 font-semibold">{money(total)}</span>
                  </div>
                  {impliedEquity != null && (
                    <div className="flex justify-between mt-0.5">
                      <span className="text-slate-400">Implied owner equity (vs {money(valueBasis!)})</span>
                      <span className={impliedEquity >= 0 ? "text-emerald-300" : "text-red-300"}>{money(impliedEquity)}</span>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-7 w-full mt-2 ${saved ? "border-green-700 text-green-400" : "border-slate-600 text-cyan-400 hover:bg-slate-800"}`}
                    disabled={saved}
                    onClick={async () => { await onSaveBalance(String(Math.round(total))); setSaved(true); }}
                  >
                    {saved ? <><Check className="h-3 w-3 mr-1" />Saved to deal</> : "Save estimated balance to deal"}
                  </Button>
                </div>
              )}

              {result.fetchedAt && <p className="text-[10px] text-slate-600 mt-1.5">Fetched {new Date(result.fetchedAt).toLocaleDateString()}{result.cached ? " (cached)" : ""}.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
