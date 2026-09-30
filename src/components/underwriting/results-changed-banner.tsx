"use client";

import { useMemo, useState } from "react";
import { X, TrendingUp } from "lucide-react";
import type { Scenario } from "@/lib/validations";

/**
 * P3-7 "results changed" banner. When a scenario was recomputed by a newer engine
 * and its stored metrics moved, previous_metrics holds the prior values plus the
 * reason. Surface the change (old -> new IRR / cash-on-cash) so an engine update is
 * visible rather than silent. Dismissible per scenario + change timestamp.
 */
function pct(v: number | undefined): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

export function ResultsChangedBanner({ scenario }: { scenario: Scenario }) {
  const prev = (scenario as unknown as { previous_metrics?: Record<string, number | string | undefined> })
    .previous_metrics;
  const cur = scenario.calculated_metrics;
  const changedAt = prev?.changed_at as string | undefined;
  const dismissKey = `rcb-dismissed:${scenario.id}:${changedAt ?? ""}`;

  const [dismissed, setDismissed] = useState(false);
  // Read prior dismissal during render (memoized on the key so switching scenarios
  // re-reads). This component only renders once its scenario is client-fetched, so
  // localStorage is available; the try/catch covers private mode / unavailability.
  const storedDismissed = useMemo(() => {
    try {
      return localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  }, [dismissKey]);

  if (!prev || !cur) return null;
  const irrMoved = prev.irr != null && cur.irr != null && Math.abs((prev.irr as number) - cur.irr) > 1e-6;
  const cocMoved =
    prev.cash_on_cash != null && cur.cash_on_cash != null && Math.abs((prev.cash_on_cash as number) - cur.cash_on_cash) > 1e-6;
  if (!irrMoved && !cocMoved) return null;
  if (dismissed || storedDismissed) return null;

  const reason = (prev.reason as string | undefined) || "Engine updated";

  function dismiss() {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* storage may be unavailable; hide for this view regardless */
    }
    setDismissed(true);
  }

  return (
    <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 text-sm text-amber-100">
        <p className="font-medium">Results changed since you last viewed</p>
        <p className="mt-0.5 text-amber-200/90">
          Engine update: {reason}.{" "}
          {irrMoved && (
            <span className="tabular-nums">
              IRR {pct(prev.irr as number)} &rarr; {pct(cur.irr)}
              {cocMoved ? " · " : ""}
            </span>
          )}
          {cocMoved && (
            <span className="tabular-nums">
              Cash-on-cash {pct(prev.cash_on_cash as number)} &rarr; {pct(cur.cash_on_cash)}
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-amber-300/70 hover:text-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
