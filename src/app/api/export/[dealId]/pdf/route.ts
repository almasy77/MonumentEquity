import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Deal, Scenario } from "@/lib/validations";

type RouteContext = { params: Promise<{ dealId: string }> };

// GET /api/export/[dealId]/pdf?scenario_id=xxx — returns a print-friendly HTML page
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const scenarioId = req.nextUrl.searchParams.get("scenario_id");

  const redis = getRedis();
  const deal = await redis.get<Deal>(`deal:${dealId}`);

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  let scenario: Scenario | null = null;
  if (scenarioId) {
    scenario = await redis.get<Scenario>(`scenario:${scenarioId}`);
    if (scenario && scenario.deal_id !== dealId) {
      scenario = null;
    }
  }

  const html = buildPdfHtml(deal, scenario);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function fmt(n: number | undefined | null, style: "currency" | "percent" | "number" = "number", decimals?: number): string {
  if (n === undefined || n === null) return "N/A";
  if (style === "currency") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: decimals ?? 0 }).format(n);
  }
  if (style === "percent") {
    return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: decimals ?? 1, maximumFractionDigits: decimals ?? 1 }).format(n);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals ?? 0 }).format(n);
}

function buildPdfHtml(deal: Deal, scenario: Scenario | null): string {
  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : null;

  const metrics = scenario?.calculated_metrics;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${deal.address} — Monument Equity</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      background: #fff;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #1e293b;
      padding-bottom: 16px;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: 0.5px;
    }
    .header .date {
      font-size: 13px;
      color: #64748b;
    }
    .property-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .property-subtitle {
      font-size: 15px;
      color: #64748b;
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 16px;
      margin-top: 32px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 32px;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .metric-label {
      font-size: 14px;
      color: #64748b;
    }
    .metric-value {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }
    .print-hint {
      margin-top: 48px;
      text-align: center;
      font-size: 13px;
      color: #94a3b8;
    }
    @media print {
      body { padding: 20px; }
      .print-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Monument Equity</h1>
    <span class="date">${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
  </div>

  <div class="property-title">${escapeHtml(deal.address)}</div>
  <div class="property-subtitle">${escapeHtml(deal.city)}, ${escapeHtml(deal.state)}${deal.zip ? " " + escapeHtml(deal.zip) : ""}</div>

  <div class="section-title">Property Overview</div>
  <div class="metrics-grid">
    <div class="metric">
      <span class="metric-label">Asking Price</span>
      <span class="metric-value">${fmt(deal.asking_price, "currency")}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Units</span>
      <span class="metric-value">${fmt(deal.units)}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Price / Unit</span>
      <span class="metric-value">${fmt(pricePerUnit, "currency")}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Year Built</span>
      <span class="metric-value">${deal.year_built ?? "N/A"}</span>
    </div>
    ${deal.property_type ? `<div class="metric">
      <span class="metric-label">Property Type</span>
      <span class="metric-value">${escapeHtml(deal.property_type)}</span>
    </div>` : ""}
    ${deal.square_footage ? `<div class="metric">
      <span class="metric-label">Square Footage</span>
      <span class="metric-value">${fmt(deal.square_footage)}</span>
    </div>` : ""}
  </div>

  <div class="section-title">Financial Summary</div>
  <div class="metrics-grid">
    ${deal.current_noi !== undefined ? `<div class="metric">
      <span class="metric-label">Current NOI</span>
      <span class="metric-value">${fmt(deal.current_noi, "currency")}</span>
    </div>` : ""}
    ${deal.in_place_cap_rate !== undefined ? `<div class="metric">
      <span class="metric-label">In-Place Cap Rate</span>
      <span class="metric-value">${fmt(deal.in_place_cap_rate, "percent")}</span>
    </div>` : ""}
    ${deal.pro_forma_noi !== undefined ? `<div class="metric">
      <span class="metric-label">Pro Forma NOI</span>
      <span class="metric-value">${fmt(deal.pro_forma_noi, "currency")}</span>
    </div>` : ""}
    ${deal.pro_forma_cap_rate !== undefined ? `<div class="metric">
      <span class="metric-label">Pro Forma Cap Rate</span>
      <span class="metric-value">${fmt(deal.pro_forma_cap_rate, "percent")}</span>
    </div>` : ""}
    ${deal.current_occupancy !== undefined ? `<div class="metric">
      <span class="metric-label">Occupancy</span>
      <span class="metric-value">${fmt(deal.current_occupancy, "percent")}</span>
    </div>` : ""}
    ${deal.grm !== undefined ? `<div class="metric">
      <span class="metric-label">GRM</span>
      <span class="metric-value">${fmt(deal.grm, "number", 2)}</span>
    </div>` : ""}
  </div>

  ${metrics ? `
  <div class="section-title">Scenario Metrics${scenario ? " — " + escapeHtml(scenario.name) : ""}</div>
  <div class="metrics-grid">
    ${metrics.irr !== undefined ? `<div class="metric">
      <span class="metric-label">IRR</span>
      <span class="metric-value">${fmt(metrics.irr, "percent")}</span>
    </div>` : ""}
    ${metrics.equity_multiple !== undefined ? `<div class="metric">
      <span class="metric-label">Equity Multiple</span>
      <span class="metric-value">${fmt(metrics.equity_multiple, "number", 2)}x</span>
    </div>` : ""}
    ${metrics.cash_on_cash !== undefined ? `<div class="metric">
      <span class="metric-label">Cash-on-Cash Return</span>
      <span class="metric-value">${fmt(metrics.cash_on_cash, "percent")}</span>
    </div>` : ""}
    ${metrics.dscr !== undefined ? `<div class="metric">
      <span class="metric-label">DSCR</span>
      <span class="metric-value">${fmt(metrics.dscr, "number", 2)}x</span>
    </div>` : ""}
    ${metrics.going_in_cap !== undefined ? `<div class="metric">
      <span class="metric-label">Going-In Cap</span>
      <span class="metric-value">${fmt(metrics.going_in_cap, "percent")}</span>
    </div>` : ""}
    ${metrics.stabilized_cap !== undefined ? `<div class="metric">
      <span class="metric-label">Stabilized Cap</span>
      <span class="metric-value">${fmt(metrics.stabilized_cap, "percent")}</span>
    </div>` : ""}
  </div>
  ` : ""}

  <p class="print-hint">Press <strong>Cmd+P</strong> (Mac) or <strong>Ctrl+P</strong> (Windows) to save as PDF</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
