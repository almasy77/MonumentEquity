import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Deal } from "@/lib/validations";

// This route sends pasted county-tax-record TEXT to Claude, forces a single
// structured-output tool call, then derives a self-consistent set of deal tax
// fields. It is TEXT-ONLY — it never fetches a URL. If URL support is ever added,
// it MUST go through `safeFetch` from "@/lib/ssrf" to guard against SSRF.

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const MAX_TEXT_LENGTH = 20000;

const SYSTEM_PROMPT = `You are a data-extraction assistant for a real-estate underwriting tool. The user pastes the raw text of a US county tax / auditor record (e.g. a Franklin County, OH auditor "Printable Page", or any county assessor page or PDF text). Extract the property-tax facts by calling the "extract_tax_record" tool.

Guidance:
- "Net Annual Tax" is the auditor's CURRENT net tax bill for the parcel (after any reduction factors / rollbacks). Prefer the NET figure over the gross.
- "Taxable Value" is the total assessed/taxable value (in Ohio this is ~35% of appraised). If land + building taxable values are listed separately, SUM them into the total.
- "Appraised Value" (a.k.a. Market Value) is the total appraised/market value. If land + building are separate, SUM them into the total.
- Extract a stated mill / effective rate only if the record explicitly prints one; do not invent it.
- Report values as raw numbers — no "$", commas, or "%".
- Omit any field you cannot find in the text. Do not guess.`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "extract_tax_record",
  description:
    "Return the property-tax fields found in the pasted county tax record. Omit any field that is not present in the text — do not guess.",
  input_schema: {
    type: "object",
    properties: {
      parcel_id: {
        type: "string",
        description: "Parcel / account / permanent-parcel number, if present.",
      },
      tax_year: {
        type: "integer",
        description: "The tax year the figures apply to, if stated (e.g. 2024).",
      },
      net_annual_tax: {
        type: "number",
        description:
          "The auditor's current NET annual tax bill for the parcel (after reduction factors / rollbacks), as a raw number.",
      },
      taxable_value_total: {
        type: "number",
        description:
          "Total taxable / assessed value (sum land + building if listed separately), as a raw number.",
      },
      appraised_value_total: {
        type: "number",
        description:
          "Total appraised / market value (sum land + building if listed separately), as a raw number.",
      },
      stated_mill_rate: {
        type: "number",
        description:
          "A mill rate or effective rate explicitly printed on the record, if any (raw number, e.g. 74.98). Omit if not stated.",
      },
      land_use_code: {
        type: "string",
        description: "Land-use / class / property-class code or description, if present.",
      },
      has_abatement: {
        type: "boolean",
        description:
          "True if the record indicates a tax abatement, exemption, CRA, TIF, or PILOT applies to the parcel.",
      },
      abatement_notes: {
        type: "string",
        description: "Short note describing any abatement / exemption / incentive found.",
      },
    },
    required: [],
  },
};

interface ExtractedTaxRecord {
  parcel_id?: string;
  tax_year?: number;
  net_annual_tax?: number;
  taxable_value_total?: number;
  appraised_value_total?: number;
  stated_mill_rate?: number;
  land_use_code?: string;
  has_abatement?: boolean;
  abatement_notes?: string;
}

// The deal fields this importer can populate.
interface TaxPatch {
  tax_mill_rate?: number;
  tax_mill_assessed_pct?: number;
  tax_assessment_pct?: number;
  tax_market_value?: number;
  assessed_value?: number;
  current_annual_taxes?: number;
  tax_year?: number;
  tax_land_use_code?: string;
  tax_abatement_present?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isPositive(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;

    // Confirm the deal exists before spending an AI call on it.
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Tax record text is required" }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: `Tax record too long (max ${MAX_TEXT_LENGTH.toLocaleString()} characters)` },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_tax_record" },
      messages: [
        {
          role: "user",
          content: `Extract the property-tax fields from this county tax record:\n\n${text}`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "Could not read a tax record from that text. Try pasting the full auditor page." },
        { status: 422 },
      );
    }

    const extracted = (toolUse.input as ExtractedTaxRecord) || {};

    // ---- Map / derive a clean, self-consistent set of deal tax fields. ----
    const patch: TaxPatch = {};
    const notes: string[] = [];
    let reconciledTax: number | null = null;

    const netTax = extracted.net_annual_tax;
    const taxable = extracted.taxable_value_total;
    const appraised = extracted.appraised_value_total;

    if (isPositive(netTax) && isPositive(taxable) && isPositive(appraised)) {
      // Common auditor case: derive NET effective mills, which auto-nets any
      // reduction factors baked into the printed Net Annual Tax.
      const millRate = round2((netTax / taxable) * 1000);
      const assessmentPct = round2((taxable / appraised) * 100);

      patch.tax_mill_rate = millRate;
      patch.tax_mill_assessed_pct = 100; // rate is already net/effective
      patch.tax_assessment_pct = assessmentPct;
      patch.tax_market_value = appraised;
      patch.assessed_value = taxable;
      patch.current_annual_taxes = netTax;

      // Sanity check: reconcile back to the printed Net Annual Tax using the
      // app's generic formula.
      const derivedAssessed = appraised * (assessmentPct / 100);
      reconciledTax = round2((millRate / 1000) * 1.0 * derivedAssessed);

      notes.push(
        `Derived net effective ${millRate} mills from Net Annual Tax ÷ Taxable Value. Assessment ratio ${assessmentPct}% (Taxable ÷ Appraised).`,
      );
      const drift = Math.abs(reconciledTax - netTax);
      if (drift > Math.max(50, netTax * 0.02)) {
        notes.push(
          `Note: reconciled tax ($${reconciledTax.toLocaleString()}) differs from the record's Net Annual Tax ($${netTax.toLocaleString()}) — double-check the source values.`,
        );
      }
    } else if (isPositive(taxable) && isPositive(appraised) && isPositive(extracted.stated_mill_rate)) {
      // No net-tax figure, but a mill rate was printed — use it as the effective rate.
      const assessmentPct = round2((taxable / appraised) * 100);
      const millRate = round2(extracted.stated_mill_rate);

      patch.tax_mill_rate = millRate;
      patch.tax_mill_assessed_pct = 100;
      patch.tax_assessment_pct = assessmentPct;
      patch.tax_market_value = appraised;
      patch.assessed_value = taxable;

      reconciledTax = round2((millRate / 1000) * 1.0 * taxable);
      patch.current_annual_taxes = reconciledTax;
      notes.push(
        `No Net Annual Tax found — used the stated ${millRate} mill rate against Taxable Value. Verify against the actual bill.`,
      );
    } else {
      // Partial data — populate whatever we can and tell the user what's missing.
      if (isPositive(appraised)) patch.tax_market_value = appraised;
      if (isPositive(taxable)) patch.assessed_value = taxable;
      if (isPositive(netTax)) patch.current_annual_taxes = netTax;
      if (isPositive(taxable) && isPositive(appraised)) {
        patch.tax_assessment_pct = round2((taxable / appraised) * 100);
      }
      if (isPositive(extracted.stated_mill_rate)) {
        patch.tax_mill_rate = round2(extracted.stated_mill_rate);
        patch.tax_mill_assessed_pct = 100;
      }
      notes.push(
        "Incomplete tax record — could not derive a full mill-rate basis. Fill in any missing fields manually before relying on the tax reassessment.",
      );
    }

    if (Number.isInteger(extracted.tax_year)) {
      patch.tax_year = extracted.tax_year;
    }
    if (extracted.land_use_code) {
      patch.tax_land_use_code = extracted.land_use_code;
    }
    if (extracted.has_abatement) {
      patch.tax_abatement_present = true;
      notes.push(
        `Abatement / exemption indicated${extracted.abatement_notes ? `: ${extracted.abatement_notes}` : ""} — this is NOT reflected in the derived mills; review separately.`,
      );
    }

    return NextResponse.json({
      patch,
      reconciled_tax: reconciledTax,
      extracted: {
        parcel_id: extracted.parcel_id,
        tax_year: extracted.tax_year,
        net_annual_tax: netTax,
        taxable_value_total: taxable,
        appraised_value_total: appraised,
        stated_mill_rate: extracted.stated_mill_rate,
        land_use_code: extracted.land_use_code,
        has_abatement: extracted.has_abatement,
        abatement_notes: extracted.abatement_notes,
      },
      notes: notes.join(" "),
    });
  } catch (err) {
    console.error("POST /api/deals/[id]/import-tax error:", err);
    // Generic message — never reflect raw exception text to the client.
    return NextResponse.json(
      { error: "Failed to import the tax record. Please try again." },
      { status: 500 },
    );
  }
}
