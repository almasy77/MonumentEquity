"use client";

import { BRIDGE_TAG_COLORS, type BridgeTag, type NoiBridge } from "@/lib/noi-bridge";

// Documented → plan → Year-1 → stabilized NOI bridge (Change C). Pure render: the
// Underwrite page passes onTag to make each item's tag editable; the share page
// renders it read-only.

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const SOURCE_LABEL: Record<string, string> = {
  deal_current_noi: "deal current NOI",
  seller_proforma_noi: "seller NOI, Pricing Views",
};

function TagChip({ tag }: { tag: BridgeTag }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: BRIDGE_TAG_COLORS[tag] }}
    >
      {tag}
    </span>
  );
}

export function NoiBridgeTable({
  bridge,
  onTag,
  pricesPending = false,
}: {
  bridge: NoiBridge;
  onTag?: (key: string, tag: BridgeTag) => void;
  pricesPending?: boolean;
}) {
  const b = bridge;
  const totalRow = "border-t border-slate-700 font-semibold text-white";
  const planValue = b.price_documented != null && b.price_with_plan != null ? b.price_with_plan - b.price_documented : null;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <tbody className="text-slate-300">
            <tr>
              <td className="py-1 pr-3">
                Documented in-place NOI{" "}
                <span className="text-slate-500">
                  ({b.documented_noi_source ? SOURCE_LABEL[b.documented_noi_source] : "none entered"})
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">{usd(b.documented_noi)}</td>
            </tr>
            {b.restatement != null && (
              <tr>
                <td className="py-1 pr-3 text-slate-400">
                  Restated to our underwriting (management, vacancy, insurance and other inputs
                  {b.has_t12_baseline ? "" : "; expense cuts are not itemized without a T12 baseline"})
                </td>
                <td className="py-1 text-right tabular-nums">{signed(b.restatement)}</td>
              </tr>
            )}
            <tr className={totalRow}>
              <td className="py-1 pr-3">= Documented NOI as we underwrite it (Year 1)</td>
              <td className="py-1 text-right tabular-nums">{usd(b.documented_model_noi)}</td>
            </tr>
            {b.items.map((i) => (
              <tr key={i.key}>
                <td className="py-1 pr-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {onTag ? (
                      <select
                        aria-label={`Tag for ${i.label}`}
                        value={i.tag}
                        onChange={(e) => onTag(i.key, e.target.value as BridgeTag)}
                        className="rounded border-0 px-1 py-0.5 text-[10px] font-semibold uppercase text-white"
                        style={{ backgroundColor: BRIDGE_TAG_COLORS[i.tag] }}
                      >
                        <option value="untagged">untagged</option>
                        <option value="plan">plan</option>
                        <option value="documented">documented</option>
                      </select>
                    ) : (
                      <TagChip tag={i.tag} />
                    )}
                    <span>{i.label}</span>
                    <span className="text-slate-500">{i.detail}</span>
                  </div>
                </td>
                <td className="py-1 text-right tabular-nums">{signed(i.noi_delta)}</td>
              </tr>
            ))}
            <tr className={totalRow}>
              <td className="py-1 pr-3">= Year-1 NOI</td>
              <td className="py-1 text-right tabular-nums">{usd(b.year1_noi)}</td>
            </tr>
            <tr>
              <td className="py-1 pr-3 text-slate-400">Lease-up, plan ramp and growth to Year {b.stabilized_year}</td>
              <td className="py-1 text-right tabular-nums">{signed(b.stabilized_noi - b.year1_noi)}</td>
            </tr>
            <tr className={totalRow}>
              <td className="py-1 pr-3">= Stabilized NOI (Year {b.stabilized_year})</td>
              <td className="py-1 text-right tabular-nums">{usd(b.stabilized_noi)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {b.documented_items.length > 0 && (
        <div className="text-[11px] text-slate-400">
          Inside documented NOI:{" "}
          {b.documented_items.map((i, n) => (
            <span key={i.key}>
              {n > 0 && " · "}
              {onTag ? (
                <button
                  type="button"
                  className="underline decoration-dotted"
                  title="Click to move this line into the plan"
                  onClick={() => onTag(i.key, "plan")}
                >
                  {i.label}
                </button>
              ) : (
                i.label
              )}
              {i.tag_source === "traced" ? " (traces to T12 / rent roll)" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded border border-slate-700 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Price on documented NOI at {(b.target_irr * 100).toFixed(0)}% IRR
          </p>
          <p className="text-sm font-bold text-white tabular-nums">{pricesPending ? "…" : usd(b.price_documented)}</p>
        </div>
        <div className="rounded border border-slate-700 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Price with plan at {(b.target_irr * 100).toFixed(0)}% IRR
          </p>
          <p className="text-sm font-bold text-white tabular-nums">{pricesPending ? "…" : usd(b.price_with_plan)}</p>
        </div>
        <div className="rounded border border-slate-700 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Plan value (ours if we pay documented)</p>
          <p className="text-sm font-bold text-white tabular-nums">{pricesPending ? "…" : usd(planValue)}</p>
        </div>
      </div>

      {b.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
          {b.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
