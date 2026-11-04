/**
 * MCP tools for the Monument underwriting app.
 *
 * Design rules (enforced here, and by tests in src/lib/__tests__/mcp-*.test.ts):
 *  - Every tool runs as the authenticated user and only sees deals whose `user_id`
 *    is that user. Someone else's deal or scenario is indistinguishable from a
 *    missing one: both answer `not_found`.
 *  - There is NO delete tool of any kind, and nothing here can mark a deal dead.
 *    Statuses reachable: pass (reason required) and reactivate.
 *  - `update_deal` only accepts an allowlist of fields; stage and status are not on it.
 *  - Writes are refused for the read-only `viewer` role; pass/reactivate are also
 *    refused for `va`, mirroring the web API ("VAs cannot change deal status").
 *  - Writes are attributed: `updated_by` / `updated_via: "connector"` on the record and
 *    `actor: "connector"` on the activity row.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getRedis, scanDealKeys } from "@/lib/db";
import { getActivitiesForDeal } from "@/lib/activity";
import { DEAL_SOURCES, SCENARIO_TYPES } from "@/lib/constants";
import { calculateUnderwriting } from "@/lib/underwriting";
import { metricsFromResult, toEngineInputs } from "@/lib/engine-version";
import {
  applyDealFieldUpdate,
  changeDealStatus,
  clearStaleStatusReasons,
  createDealRecord,
  staleStatusReasons,
} from "@/lib/deal-service";
import {
  applyScenarioUpdate,
  createScenarioFromDefaults,
  underwritingPayload,
} from "@/lib/scenario-service";
import type { Deal, Scenario } from "@/lib/validations";
import type { McpAuthContext } from "./auth";
import { applyOtherIncomeItems } from "./other-income";

// ─── result helpers ─────────────────────────────────────────

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

export type ErrorCode = "not_found" | "forbidden" | "invalid_input" | "conflict" | "internal_error";

const fail = (code: ErrorCode, message: string, extra: Record<string, unknown> = {}): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }) }],
});

const NOT_FOUND = (what: "deal" | "scenario") => fail("not_found", `No ${what} with that id.`);

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

// ─── access control ─────────────────────────────────────────

/** Load a deal only if the caller owns it. Someone else's deal is reported as missing. */
async function loadOwnedDeal(ctx: McpAuthContext, id: string): Promise<Deal | null> {
  const deal = await getRedis().get<Deal>(`deal:${id}`);
  return deal && deal.user_id === ctx.userId ? deal : null;
}

async function loadOwnedScenario(
  ctx: McpAuthContext,
  id: string
): Promise<{ scenario: Scenario; deal: Deal } | null> {
  const scenario = await getRedis().get<Scenario>(`scenario:${id}`);
  if (!scenario) return null;
  const deal = await loadOwnedDeal(ctx, scenario.deal_id);
  return deal ? { scenario, deal } : null;
}

const canWrite = (ctx: McpAuthContext) => ctx.role !== "viewer";
const canChangeStatus = (ctx: McpAuthContext) => ctx.role === "admin";
const READ_ONLY = () => fail("forbidden", "This account has read-only access.");

// ─── shaping ────────────────────────────────────────────────

function dealSummary(d: Deal) {
  return {
    id: d.id,
    address: d.address,
    city: d.city,
    state: d.state,
    units: d.units,
    asking_price: d.asking_price,
    bid_price: d.bid_price ?? null,
    stage: d.stage,
    status: d.status,
    source: d.source,
    updated_at: d.updated_at,
    last_activity_at: d.last_activity_at,
    ...(d.status !== "active" ? { pass_reason: d.pass_reason ?? null, kill_reason: d.kill_reason ?? null } : {}),
  };
}

async function loadScenarios(dealId: string): Promise<Scenario[]> {
  const redis = getRedis();
  const ids = await redis.zrange(`scenarios:by_deal:${dealId}`, 0, -1, { rev: true });
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.get(`scenario:${id}`);
  const rows = await pipeline.exec<(Scenario | null)[]>();
  return rows.filter((r): r is Scenario => r !== null);
}

function scenarioSummary(s: Scenario) {
  return {
    id: s.id,
    deal_id: s.deal_id,
    name: s.name,
    type: s.type,
    version: s.version,
    is_active: s.is_active,
    calculated_metrics: s.calculated_metrics ?? null,
    updated_at: s.updated_at,
    updated_by: s.updated_by ?? null,
    updated_via: s.updated_via ?? null,
  };
}

const normAddr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ─── schemas ────────────────────────────────────────────────

const id = (what: string) => z.string().min(1).max(100).describe(what);
const money = z.number().positive().finite();
const nullableNum = z.number().finite().nullable().optional();
const assumptions = (what: string) => z.record(z.string(), z.unknown()).optional().describe(what);

/**
 * Fields `update_deal` may change. Deliberately EXCLUDES: stage, status, kill_reason,
 * pass_reason (use pass_deal / reactivate_deal), user/audit fields, files, photos,
 * contacts, rent roll and T12. `null` clears an optional field.
 */
export const DEAL_UPDATE_FIELDS = z.strictObject({
  address: z.string().min(1).max(300).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(50).optional(),
  zip: z.string().max(20).nullable().optional(),
  county: z.string().max(100).nullable().optional(),
  units: z.number().int().positive().max(5000).optional(),
  year_built: z.number().int().min(1600).max(2100).nullable().optional(),
  property_type: z.string().max(100).nullable().optional(),
  square_footage: z.number().positive().finite().nullable().optional(),
  asking_price: money.optional(),
  bid_price: money.nullable().optional(),
  source: z.enum(DEAL_SOURCES).optional(),
  source_url: z.url().max(2000).nullable().optional(),
  market_notes: z.string().max(50000).nullable().optional(),
  // Seller/broker financials
  current_noi: nullableNum,
  current_occupancy: z
    .number()
    .gt(0)
    .max(1, "current_occupancy is a fraction between 0 and 1 (92% => 0.92), not a percent")
    .nullable()
    .optional(),
  current_annual_taxes: z.number().min(0).finite().nullable().optional(),
  current_annual_insurance: z.number().min(0).finite().nullable().optional(),
  assessed_value: z.number().min(0).finite().nullable().optional(),
  // Property-tax basis
  tax_year: z.number().int().min(1900).max(2100).nullable().optional(),
  tax_land_use_code: z.string().max(200).nullable().optional(),
  tax_abatement_present: z.boolean().nullable().optional(),
  tax_cauv: z.boolean().nullable().optional(),
  tax_reappraisal_in_progress: z.boolean().nullable().optional(),
  tax_record_url: z.url().max(2000).nullable().optional(),
  tax_mill_rate: z.number().min(0).finite().nullable().optional(),
  tax_mill_assessed_pct: z.number().min(0).finite().nullable().optional(),
  tax_assessment_pct: z.number().min(0).finite().nullable().optional(),
  tax_market_value: z.number().min(0).finite().nullable().optional(),
  county_site_address: z.string().max(300).nullable().optional(),
  incentive_type: z.string().max(100).nullable().optional(),
  granting_authority: z.string().max(200).nullable().optional(),
  // Ownership (county records)
  owner_name: z.string().max(200).nullable().optional(),
  owner_since: z.string().max(40).nullable().optional(),
  owner_acquisition_price: z.number().min(0).finite().nullable().optional(),
  owner_mailing_address: z.string().max(300).nullable().optional(),
  owner_notes: z.string().max(5000).nullable().optional(),
  owner_loan_balance_est: z.number().min(0).finite().nullable().optional(),
});

const otherIncomeItems = z
  .array(
    z.object({
      label: z.string().min(1).max(100).describe('e.g. "Laundry", "Parking", "Pet rent", "RUBS - Electric"'),
      monthly: z.number().min(0).finite().describe("Dollars per month for the whole property"),
      recurring: z.boolean().optional().describe("false = one-time / in-period only; excluded from exit value. Default true."),
    })
  )
  .max(40)
  .optional()
  .describe(
    "Itemized other income, one entry per income source (each gets its own line). REPLACES any existing itemized lines, sub-lines and RUBS setting, and sets other_income_monthly to their sum."
  );

const SECTIONS = {
  purchase_assumptions: assumptions("Purchase inputs (e.g. purchase_price, bid_price, closing_cost_rate)."),
  financing_assumptions: assumptions("Financing inputs (ltv, interest_rate, amortization_years, loan_term_years, io_period_months, ...)."),
  revenue_assumptions: assumptions(
    "Revenue inputs: unit_mix rows [{type, count, current_rent, market_rent, renovated_rent_premium}], vacancy_rate (fraction, 0.07 = 7%), bad_debt_rate, concessions_rate, rent_growth_rate, other_income_monthly. Prefer other_income_items for other income."
  ),
  expense_assumptions: assumptions("Operating expense inputs."),
  capex_assumptions: assumptions("CapEx inputs, including projects[]."),
  exit_assumptions: assumptions("Exit inputs (exit_cap_rate, hold period, ...)."),
  depreciation_assumptions: assumptions("Depreciation / cost-seg inputs."),
  tax_assumptions: z.record(z.string(), z.unknown()).nullable().optional().describe("After-tax layer inputs; null disables it."),
};

// ─── tool definitions ───────────────────────────────────────

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const WRITE_IDEMPOTENT: ToolAnnotations = { ...WRITE, idempotentHint: true };

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, z.ZodType<any>>;
  annotations: ToolAnnotations;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: McpAuthContext) => Promise<ToolResult>;
}

function defineTool<S extends Record<string, z.ZodType>>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<S>>, ctx: McpAuthContext) => Promise<ToolResult>;
}): ToolDef {
  return def as unknown as ToolDef;
}

export const TOOLS: ToolDef[] = [
  defineTool({
    name: "list_deals",
    title: "List deals",
    description:
      "List your deals. Active deals by default; set include_archived to also include passed/dead deals (with their pass/kill reason).",
    inputSchema: { include_archived: z.boolean().optional().describe("Also include passed and dead deals. Default false.") },
    annotations: READ,
    async run({ include_archived }, ctx) {
      const redis = getRedis();
      const ids = await redis.zrange("deals:active", 0, 499, { rev: true });
      const out: Deal[] = [];
      if (ids.length > 0) {
        const pipeline = redis.pipeline();
        for (const i of ids) pipeline.get(`deal:${i}`);
        const rows = await pipeline.exec<(Deal | null)[]>();
        for (const d of rows) if (d && d.user_id === ctx.userId) out.push(d);
      }
      if (include_archived) {
        const keys = await scanDealKeys();
        if (keys.length > 0) {
          const pipeline = redis.pipeline();
          for (const key of keys) pipeline.get(key);
          const rows = await pipeline.exec<(Deal | null)[]>();
          const archived = rows
            .filter((d): d is Deal => !!d && d.user_id === ctx.userId && (d.status === "dead" || d.status === "passed"))
            .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
          out.push(...archived);
        }
      }
      return ok({ count: out.length, deals: out.map(dealSummary) });
    },
  }),

  defineTool({
    name: "get_deal",
    title: "Get deal",
    description:
      "Get every field of one deal (market_notes, tax and owner fields, files, pass_reason, ...) plus its scenarios (id, name, type, metrics) so you can go straight to get_scenario.",
    inputSchema: { deal_id: id("Deal id") },
    annotations: READ,
    async run({ deal_id }, ctx) {
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      const scenarios = await loadScenarios(deal.id);
      return ok({ deal, scenarios: scenarios.map(scenarioSummary) });
    },
  }),

  defineTool({
    name: "create_deal",
    title: "Create deal",
    description:
      "Create a new active deal in the Lead stage. Refuses (conflict) if you already have an active deal at the same address and city, unless allow_duplicate is true.",
    inputSchema: {
      address: z.string().min(1).max(300),
      city: z.string().min(1).max(100),
      state: z.string().min(1).max(50),
      zip: z.string().max(20).optional(),
      units: z.number().int().positive().max(5000),
      year_built: z.number().int().min(1600).max(2100).optional(),
      asking_price: money,
      bid_price: money.optional(),
      source: z.enum(DEAL_SOURCES),
      source_url: z.url().max(2000).optional().describe("Link to the listing"),
      market_notes: z.string().max(50000).optional(),
      allow_duplicate: z.boolean().optional(),
    },
    annotations: WRITE,
    async run({ allow_duplicate, ...input }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      if (!allow_duplicate) {
        const redis = getRedis();
        const ids = await redis.zrange("deals:active", 0, 499, { rev: true });
        if (ids.length > 0) {
          const pipeline = redis.pipeline();
          for (const i of ids) pipeline.get(`deal:${i}`);
          const rows = await pipeline.exec<(Deal | null)[]>();
          const dup = rows.find(
            (d) =>
              d &&
              d.user_id === ctx.userId &&
              normAddr(d.address) === normAddr(input.address) &&
              normAddr(d.city) === normAddr(input.city)
          );
          if (dup) {
            return fail("conflict", `You already have an active deal at ${dup.address}, ${dup.city}. Pass allow_duplicate: true to create it anyway.`, {
              existing_deal_id: dup.id,
            });
          }
        }
      }
      const deal = await createDealRecord(input, ctx.userId, "connector");
      return ok({ deal });
    },
  }),

  defineTool({
    name: "update_deal",
    title: "Update deal fields",
    description:
      "Change allowlisted fields on one of your deals; other fields are untouched. `null` clears an optional field. Stage and status cannot be changed here (use pass_deal / reactivate_deal). Records the change in the activity feed with the field names.",
    inputSchema: {
      deal_id: id("Deal id"),
      fields: DEAL_UPDATE_FIELDS.describe("Fields to set. current_occupancy is a 0-1 fraction."),
    },
    annotations: WRITE_IDEMPOTENT,
    async run({ deal_id, fields }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      const parsed = DEAL_UPDATE_FIELDS.safeParse(fields);
      if (!parsed.success) return fail("invalid_input", formatIssues(parsed.error));
      const { deal: updated, changed } = await applyDealFieldUpdate(deal, parsed.data, ctx.userId, "connector");
      return ok({ deal: updated, changed_fields: changed });
    },
  }),

  defineTool({
    name: "pass_deal",
    title: "Pass on deal",
    description:
      "Pass on an active deal (moves it to Archived). A reason is required and is stored as pass_reason. Reversible with reactivate_deal. Admin accounts only.",
    inputSchema: { deal_id: id("Deal id"), reason: z.string().trim().min(3).max(500).describe("Why you're passing, e.g. 'Seller won't move off $2.1M; DSCR 0.92 at ask'") },
    annotations: WRITE_IDEMPOTENT,
    async run({ deal_id, reason }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      if (!canChangeStatus(ctx)) return fail("forbidden", "Only admin accounts can change a deal's status.");
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      if (deal.status !== "active") return fail("conflict", `Deal is already ${deal.status}.`);
      const updated = await changeDealStatus(deal, { status: "passed", reason }, ctx.userId, "connector");
      return ok({ deal: dealSummary(updated) });
    },
  }),

  defineTool({
    name: "reactivate_deal",
    title: "Reactivate deal",
    description:
      "Move a passed or archived deal back to active (like the Reactivate button) and clear its old pass/kill reason. If the deal is already active but still carries a stale pass_reason/kill_reason from an earlier reactivation, this clears those instead of failing. Admin accounts only.",
    inputSchema: { deal_id: id("Deal id") },
    annotations: WRITE_IDEMPOTENT,
    async run({ deal_id }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      if (!canChangeStatus(ctx)) return fail("forbidden", "Only admin accounts can change a deal's status.");
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      if (deal.status === "active") {
        if (staleStatusReasons(deal).length === 0) return fail("conflict", "Deal is already active.");
        const { deal: cleaned, cleared } = await clearStaleStatusReasons(deal, ctx.userId, "connector");
        return ok({ deal: dealSummary(cleaned), cleared_stale_fields: cleared });
      }
      const updated = await changeDealStatus(deal, { status: "active" }, ctx.userId, "connector");
      return ok({ deal: dealSummary(updated) });
    },
  }),

  defineTool({
    name: "list_scenarios",
    title: "List scenarios",
    description: "List a deal's scenarios with their headline metrics (IRR, cash-on-cash, DSCR, equity multiple, caps).",
    inputSchema: { deal_id: id("Deal id") },
    annotations: READ,
    async run({ deal_id }, ctx) {
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      const scenarios = await loadScenarios(deal.id);
      return ok({ count: scenarios.length, scenarios: scenarios.map(scenarioSummary) });
    },
  }),

  defineTool({
    name: "get_scenario",
    title: "Get scenario",
    description:
      "Get one scenario: its stored assumptions plus a fresh underwriting run — `underwriting.metrics` (calculated metrics), `underwriting.annual` (year-by-year), warnings, and the after-tax layer when enabled. The monthly pro forma and sensitivity grids are omitted unless requested.",
    inputSchema: {
      scenario_id: id("Scenario id"),
      include_monthly: z.boolean().optional().describe("Include the monthly pro forma (large)."),
      include_sensitivity: z.boolean().optional().describe("Include sensitivity grids (large)."),
    },
    annotations: READ,
    async run({ scenario_id, include_monthly, include_sensitivity }, ctx) {
      const found = await loadOwnedScenario(ctx, scenario_id);
      if (!found) return NOT_FOUND("scenario");
      const result = calculateUnderwriting(toEngineInputs(found.scenario));
      const uw = underwritingPayload(result);
      return ok({
        // Report the freshly computed headline metrics (not persisted by a read).
        scenario: { ...found.scenario, calculated_metrics: metricsFromResult(result) },
        underwriting: {
          metrics: uw.metrics,
          annual: uw.annual,
          warnings: uw.warnings,
          tax: uw.tax,
          ...(include_monthly ? { monthly: uw.monthly } : {}),
          ...(include_sensitivity ? { sensitivity: uw.sensitivity } : {}),
        },
      });
    },
  }),

  defineTool({
    name: "create_scenario",
    title: "Create scenario",
    description:
      "Create a scenario on one of your deals. Starts from the deal's data and your default assumptions, applies the scenario type's presets, then your overrides, and runs the underwriting. Returns the scenario and its calculated metrics.",
    inputSchema: {
      deal_id: id("Deal id"),
      name: z.string().min(1).max(100).optional().describe('Default "Base Case"'),
      type: z.enum(SCENARIO_TYPES).optional().describe('Default "base"'),
      ...SECTIONS,
      other_income_items: otherIncomeItems,
    },
    annotations: WRITE,
    async run({ deal_id, other_income_items, ...body }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      if (other_income_items) {
        body.revenue_assumptions = applyOtherIncomeItems(body.revenue_assumptions ?? {}, other_income_items);
      }
      const { scenario, result } = await createScenarioFromDefaults(deal, body, ctx.userId, "connector");
      return ok({
        scenario,
        calculated_metrics: scenario.calculated_metrics,
        warnings: result.warnings,
      });
    },
  }),

  defineTool({
    name: "update_scenario",
    title: "Update scenario",
    description:
      "Update a scenario and recalculate. Each assumption section you pass is SHALLOW-MERGED into the stored one by key (omitted keys are kept; an array such as unit_mix or capex projects is replaced whole). The prior version is snapshotted. Returns the updated scenario and its calculated metrics.",
    inputSchema: {
      scenario_id: id("Scenario id"),
      name: z.string().min(1).max(100).optional(),
      type: z.enum(SCENARIO_TYPES).optional(),
      is_active: z.boolean().optional(),
      notes: z.string().max(20000).optional().describe("Rationale / thinking behind this scenario"),
      ...SECTIONS,
      other_income_items: otherIncomeItems,
    },
    annotations: WRITE_IDEMPOTENT,
    async run({ scenario_id, other_income_items, ...patch }, ctx) {
      if (!canWrite(ctx)) return READ_ONLY();
      const found = await loadOwnedScenario(ctx, scenario_id);
      if (!found) return NOT_FOUND("scenario");
      const existing = found.scenario as unknown as Record<string, unknown>;

      const merged: Record<string, unknown> = { ...patch };
      for (const key of [
        "purchase_assumptions",
        "financing_assumptions",
        "revenue_assumptions",
        "expense_assumptions",
        "capex_assumptions",
        "exit_assumptions",
        "depreciation_assumptions",
      ] as const) {
        const incoming = patch[key];
        if (incoming) merged[key] = { ...(existing[key] as object | undefined), ...incoming };
      }
      if (other_income_items) {
        const base = (merged.revenue_assumptions as Record<string, unknown> | undefined) ?? (existing.revenue_assumptions as Record<string, unknown>);
        merged.revenue_assumptions = applyOtherIncomeItems(base, other_income_items);
      }
      // tax_assumptions: null disables the layer, an object replaces it, absent keeps it.
      if (patch.tax_assumptions === undefined) delete merged.tax_assumptions;

      const { scenario, result } = await applyScenarioUpdate(found.scenario, merged, ctx.userId, "connector");
      return ok({ scenario, calculated_metrics: scenario.calculated_metrics, warnings: result.warnings });
    },
  }),

  defineTool({
    name: "get_deal_activity",
    title: "Get deal activity",
    description:
      "Activity feed for a deal, newest first, with exact ISO timestamps: scenario created/updated, status changed, deal field updates, etc. Each row says who (user_id) and where the change came from (actor: 'web' = the app UI, 'connector' = Claude).",
    inputSchema: {
      deal_id: id("Deal id"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
      offset: z.number().int().min(0).optional(),
      since: z.iso.datetime({ offset: true }).optional().describe("Only events at or after this ISO timestamp"),
    },
    annotations: READ,
    async run({ deal_id, limit, offset, since }, ctx) {
      const deal = await loadOwnedDeal(ctx, deal_id);
      if (!deal) return NOT_FOUND("deal");
      const rows = await getActivitiesForDeal(deal.id, limit ?? 50, offset ?? 0);
      const sinceMs = since ? Date.parse(since) : null;
      const events = rows
        .filter((a) => sinceMs === null || Date.parse(a.timestamp) >= sinceMs)
        .map((a) => ({
          id: a.id,
          timestamp: a.timestamp,
          action: a.action,
          entity_type: a.entity_type,
          entity_id: a.entity_id,
          details: a.details ?? null,
          user_id: a.user_id,
          actor: a.actor ?? "web",
        }));
      return ok({ deal_id: deal.id, count: events.length, events });
    },
  }),
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export const SERVER_INSTRUCTIONS = [
  "Monument Equity underwriting app. Tools act as the signed-in user and only see that user's deals.",
  "Start with list_deals, then get_deal (it lists the deal's scenario ids) and get_scenario.",
  "Percentages and rates are fractions (0.07 = 7%), including vacancy_rate and current_occupancy.",
  "update_scenario shallow-merges each assumption section; send whole arrays (unit_mix, capex projects) when changing them.",
  "There is no delete tool and nothing here can mark a deal dead; pass_deal is reversible with reactivate_deal.",
].join("\n");

// ─── registration ───────────────────────────────────────────

export function registerTools(server: McpServer, ctx: McpAuthContext): void {
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema, annotations: def.annotations },
      async (args: unknown): Promise<ToolResult> => {
        try {
          return await def.run(args, ctx);
        } catch (err) {
          console.error(`MCP tool ${def.name} failed:`, err);
          return fail("internal_error", "The tool failed unexpectedly. Try again; if it persists, check the app logs.");
        }
      }
    );
  }
}
