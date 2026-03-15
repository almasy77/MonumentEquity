import { z } from "zod/v4";
import {
  DEAL_STAGES,
  DEAL_SOURCES,
  CONTACT_TYPES,
  SCENARIO_TYPES,
  TASK_PRIORITIES,
  USER_ROLES,
} from "./constants";

// ─── User ───────────────────────────────────────────────────
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.email(),
  name: z.string().min(1),
  password_hash: z.string(),
  role: z.enum(USER_ROLES),
  default_assumptions: z.record(z.string(), z.number()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

// ─── Deal ───────────────────────────────────────────────────
export const dealSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  stage: z.enum(DEAL_STAGES),
  status: z.enum(["active", "dead", "passed"]),

  // Property info
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().optional(),
  county: z.string().optional(),
  units: z.number().int().positive(),
  year_built: z.number().int().optional(),
  property_type: z.string().optional(),
  square_footage: z.number().optional(),

  // Pricing
  asking_price: z.number().positive(),
  bid_price: z.number().optional(),

  // Source
  source: z.enum(DEAL_SOURCES),
  source_url: z.string().url().optional(),

  // Notes
  market_notes: z.string().optional(),
  kill_reason: z.string().optional(),
  pass_reason: z.string().optional(),

  // LOI
  loi_amount: z.number().optional(),
  loi_date: z.string().optional(),
  loi_expiration: z.string().optional(),
  earnest_money: z.number().optional(),

  // Due Diligence
  dd_start_date: z.string().optional(),
  dd_end_date: z.string().optional(),

  // Closing
  closing_date: z.string().optional(),
  final_purchase_price: z.number().optional(),
  lender: z.string().optional(),
  loan_amount: z.number().optional(),

  // Relationships
  contact_ids: z.array(z.string().uuid()).default([]),

  // Audit
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_activity_at: z.string().datetime(),
});

export type Deal = z.infer<typeof dealSchema>;

export const createDealSchema = dealSchema.omit({
  id: true,
  user_id: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  last_activity_at: true,
});

// ─── Contact ────────────────────────────────────────────────
export const contactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  company: z.string().optional(),
  type: z.enum(CONTACT_TYPES),
  email: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  deal_ids: z.array(z.string().uuid()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Contact = z.infer<typeof contactSchema>;

// ─── Scenario ───────────────────────────────────────────────
export const capexProjectSchema = z.object({
  name: z.string().min(1),
  cost: z.number().positive(),
  start_month: z.number().int().min(1),
  duration_months: z.number().int().min(1),
  category: z.string().optional(),
});

export type CapexProject = z.infer<typeof capexProjectSchema>;

export const scenarioSchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(SCENARIO_TYPES),
  version: z.number().int().default(1),
  is_active: z.boolean().default(true),

  purchase_assumptions: z.record(z.string(), z.unknown()).default({}),
  financing_assumptions: z.record(z.string(), z.unknown()).default({}),
  revenue_assumptions: z.record(z.string(), z.unknown()).default({}),
  expense_assumptions: z.record(z.string(), z.unknown()).default({}),
  capex_assumptions: z
    .object({
      per_unit_cost: z.number().optional(),
      units_to_renovate: z.number().optional(),
      units_per_month: z.number().optional(),
      projects: z.array(capexProjectSchema).default([]),
      reserves_per_unit: z.number().optional(),
    })
    .default({ projects: [] }),
  exit_assumptions: z.record(z.string(), z.unknown()).default({}),

  monthly_pro_forma: z.unknown().optional(),
  calculated_metrics: z
    .object({
      irr: z.number().optional(),
      cash_on_cash: z.number().optional(),
      dscr: z.number().optional(),
      equity_multiple: z.number().optional(),
      going_in_cap: z.number().optional(),
      stabilized_cap: z.number().optional(),
    })
    .optional(),

  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Scenario = z.infer<typeof scenarioSchema>;

// ─── Task ───────────────────────────────────────────────────
export const taskSchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  due_date: z.string(),
  completed: z.boolean().default(false),
  completed_at: z.string().optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
});

export type Task = z.infer<typeof taskSchema>;

// ─── Market Comp ────────────────────────────────────────────
export const marketCompSchema = z.object({
  id: z.string().uuid(),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().optional(),
  units: z.number().int().positive(),
  sale_price: z.number().positive(),
  sale_date: z.string(),
  price_per_unit: z.number().positive(),
  cap_rate: z.number().optional(),
  year_built: z.number().int().optional(),
  property_type: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  created_at: z.string().datetime(),
});

export type MarketComp = z.infer<typeof marketCompSchema>;

// ─── Rent Comp ──────────────────────────────────────────────
export const rentCompSchema = z.object({
  id: z.string().uuid(),
  property_name: z.string().optional(),
  address: z.string().min(1),
  city: z.string().min(1),
  submarket: z.string().optional(),
  unit_type: z.string().optional(),
  bedrooms: z.number().int().optional(),
  bathrooms: z.number().optional(),
  square_footage: z.number().optional(),
  rent: z.number().positive(),
  rent_per_sqft: z.number().optional(),
  amenities: z.string().optional(),
  date_observed: z.string(),
  source: z.string().optional(),
  notes: z.string().optional(),
  created_at: z.string().datetime(),
});

export type RentComp = z.infer<typeof rentCompSchema>;

// ─── Activity Log ───────────────────────────────────────────
export const activitySchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  user_id: z.string().uuid(),
  timestamp: z.string().datetime(),
});

export type Activity = z.infer<typeof activitySchema>;

// ─── Share Link ─────────────────────────────────────────────
export const shareLinkSchema = z.object({
  token: z.string(),
  deal_id: z.string().uuid(),
  scenario_ids: z.array(z.string().uuid()).optional(),
  expires_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

export type ShareLink = z.infer<typeof shareLinkSchema>;
