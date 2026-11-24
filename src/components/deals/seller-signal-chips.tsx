import { deriveSellerSignals, sellerSignalChips, type SellerSignalInputs } from "@/lib/seller-motivation";

// Change E: seller-motivation chips (days on market, price cuts, tax delinquency,
// out-of-state owner, hold years). Display only — no scoring, no gates. Renders
// nothing when no signal is known.
export function SellerSignalChips({ deal, compact = false }: { deal: SellerSignalInputs; compact?: boolean }) {
  const chips = sellerSignalChips(deriveSellerSignals(deal));
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={`rounded-full border ${c.key === "taxdel" ? "border-amber-600/60 text-amber-300" : "border-slate-600 text-slate-300"} bg-slate-800/60 ${compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs"}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
