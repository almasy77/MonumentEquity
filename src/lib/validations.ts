import { z } from "zod/v4";
import {
  DEAL_STAGES,
  DEAL_SOURCES,
  CONTACT_TYPES,
  SCENARIO_TYPES,
  TASK_PRIORITIES,
  USER_ROLES,
} from "./constants";

// ─── Notification Preferences ──────────────────────────────
export const notificationPrefsSchema = z.object({
  email_digest: z.boolean().default(false),
  digest_frequency: z.enum(["daily", "weekly", "never"]).default("daily"),
  stale_deal_alerts: z.boolean().default(true),
  task_due_reminders: z.boolean().default(true),
  task_reminder_hours: z.number().default(24),
  dd_expiration_alerts: z.boolean().default(true),
  closing_reminders: z.boolean().default(true),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

// ─── User ───────────────────────────────────────────────────
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.email(),
  name: z.string().min(1),
  password_hash: z.string(),
  role: z.enum(USER_ROLES),
  default_assumptions: z.record(z.string(), z.number()).optional(),
  notification_prefs: notificationPrefsSchema.optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

// ─── Rent Roll ──────────────────────────────────────────────
export const rentRollUnitSchema = z.object({
  unit_number: z.string(),
  unit_type: z.string().optional(), // "1BR/1BA", "2BR/1BA", "Studio"
  sqft: z.number().optional(),
  tenant_name: z.string().optional(),
  status: z.enum(["occupied", "vacant", "notice_to_vacate", "down"]).default("occupied"),
  lease_start: z.string().optional(),
  lease_end: z.string().optional(),
  move_in_date: z.string().optional(),
  current_rent: z.number().optional(),
  market_rent: z.number().optional(),
  other_charges: z.number().optional(), // parking, pet, storage, utilities
  security_deposit: z.number().optional(),
  concessions: z.number().optional(), // monthly concession amount
  notes: z.string().optional(),
});
export type RentRollUnit = z.infer<typeof rentRollUnitSchema>;

// ─── T12 Operating Statement ────────────────────────────────
export const t12MonthSchema = z.object({
  month: z.string(), // "2025-01", "2025-02", etc.
  // Income
  gross_potential_rent: z.number().optional(),
  vacancy_loss: z.number().optional(),
  credit_loss: z.number().optional(),
  concessions: z.number().optional(),
  laundry_income: z.number().optional(),
  parking_income: z.number().optional(),
  pet_fees: z.number().optional(),
  application_fees: z.number().optional(),
  late_fees: z.number().optional(),
  utility_reimbursements: z.number().optional(),
  storage_income: z.number().optional(),
  other_income: z.number().optional(),
  // Expenses
  property_taxes: z.number().optional(),
  insurance: z.number().optional(),
  utilities: z.number().optional(),
  repairs_maintenance: z.number().optional(),
  turnover_costs: z.number().optional(),
  landscaping: z.number().optional(),
  payroll: z.number().optional(),
  management_fees: z.number().optional(),
  admin_expenses: z.number().optional(),
  marketing: z.number().optional(),
  contract_services: z.number().optional(),
  trash_removal: z.number().optional(),
  pest_control: z.number().optional(),
  other_expenses: z.number().optional(),
});
export type T12Month = z.infer<typeof t12MonthSchema>;

export const t12StatementSchema = z.object({
  period_start: z.string().optional(), // "2025-01"
  period_end: z.string().optional(),   // "2025-12"
  months: z.array(t12MonthSchema).default([]),
  // Annual totals (can be computed or entered directly)
  total_gpi: z.number().optional(), // Gross Potential Income
  total_egi: z.number().optional(), // Effective Gross Income
  total_opex: z.number().optional(),
  total_noi: z.number().optional(),
  source: z.string().optional(), // "seller_provided", "broker_om", "verified", "estimated"
  notes: z.string().optional(),
});
export type T12Statement = z.infer<typeof t12StatementSchema>;

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

  // Building details (BlueChariot / listing detail fields)
  lot_size: z.string().optional(), // e.g. "0.45 acres"
  zoning: z.string().optional(),
  parking_spaces: z.number().optional(),
  parking_type: z.string().optional(), // "surface", "garage", "street"
  construction_type: z.string().optional(), // "wood_frame", "masonry", "steel"
  roof_type: z.string().optional(),
  roof_condition: z.string().optional(), // "good", "fair", "poor", "replaced_recently"
  hvac_type: z.string().optional(), // "central", "window_units", "ptac", "mini_split"
  laundry_type: z.string().optional(), // "in_unit", "common_area", "none"
  water_heater: z.string().optional(), // "individual", "central_boiler"
  electrical: z.string().optional(), // "individual_meters", "master_metered"
  plumbing: z.string().optional(), // "copper", "pex", "galvanized", "mixed"
  foundation: z.string().optional(), // "slab", "crawl_space", "basement"
  stories: z.number().optional(),
  elevators: z.boolean().optional(),
  amenities: z.array(z.string()).optional(), // ["pool", "gym", "laundry", "playground"]

  // Financial data from seller / broker OM
  current_noi: z.number().optional(), // Seller-reported current NOI
  current_occupancy: z.number().optional(), // 0-1, e.g. 0.92
  pro_forma_noi: z.number().optional(), // Broker pro forma NOI
  in_place_cap_rate: z.number().optional(), // current_noi / asking_price
  pro_forma_cap_rate: z.number().optional(),
  grm: z.number().optional(), // Gross Rent Multiplier
  current_annual_taxes: z.number().optional(),
  current_annual_insurance: z.number().optional(),
  assessed_value: z.number().optional(),
  tax_rate: z.number().optional(), // mill rate

  // Rent roll & T12
  rent_roll: z.array(rentRollUnitSchema).optional(),
  rent_roll_date: z.string().optional(), // date rent roll was generated
  t12: t12StatementSchema.optional(),

  // Property photos
  photos: z.array(z.string()).optional(), // URL strings

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

  // Financing
  lender: z.string().optional(),
  lender_contact: z.string().optional(), // name of loan officer
  loan_amount: z.number().optional(),
  loan_type: z.string().optional(), // "agency", "bank", "dscr", "bridge", "seller_finance"
  ltv: z.number().optional(), // 0-1, e.g. 0.75
  interest_rate: z.number().optional(), // annual, e.g. 0.065
  rate_type: z.string().optional(), // "fixed", "floating", "hybrid"
  rate_index: z.string().optional(), // "SOFR", "Treasury", "Prime"
  rate_spread: z.number().optional(), // spread over index for floating
  loan_term_years: z.number().optional(),
  amortization_years: z.number().optional(),
  io_period_months: z.number().optional(), // interest-only period
  origination_fee_rate: z.number().optional(), // % of loan
  prepayment_penalty: z.string().optional(), // "yield_maintenance", "defeasance", "step_down", "none"
  dscr_requirement: z.number().optional(), // lender minimum DSCR
  loan_status: z.string().optional(), // "shopping", "term_sheet", "application", "approved", "closed"
  term_sheet_date: z.string().optional(),
  loan_closing_date: z.string().optional(),
  monthly_debt_service: z.number().optional(), // can be computed or entered

  // Buy Box Scores (persisted)
  buy_box_scores: z.object({
    qualitative_factors: z.array(z.object({
      label: z.string(),
      weight: z.number(),
      score: z.number(),
    })).optional(),
    neighborhood_factors: z.array(z.object({
      label: z.string(),
      weight: z.number(),
      score: z.number(),
    })).optional(),
    rehab_per_unit: z.number().optional(),
    in_place_cap: z.number().optional(),
    stabilized_yield: z.number().optional(),
    dscr: z.number().optional(),
    neighborhood_score: z.number().optional(),
    final_score: z.number().optional(),
    recommendation: z.string().optional(), // "PURSUE", "MAYBE", "PASS"
    scored_at: z.string().optional(),
  }).optional(),

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
export const phoneEntrySchema = z.object({
  number: z.string().min(1),
  label: z.string().default("mobile"), // mobile, office, home, fax, other
});

export type PhoneEntry = z.infer<typeof phoneEntrySchema>;

export const contactSchema = z.object({
  id: z.string().uuid(),
  // Structured name fields (new)
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  nickname: z.string().optional(),
  // Legacy "name" kept for backward compat during migration
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(), // "Managing Director", "Loan Officer", etc.
  type: z.enum(CONTACT_TYPES),
  tags: z.array(z.string()).default([]), // free-form tags: ["durham", "multifamily", "responsive"]
  email: z.string().optional(),
  phone: z.string().optional(), // primary phone (legacy)
  phones: z.array(phoneEntrySchema).default([]), // multiple phones with labels
  website: z.string().optional(),
  linkedin_url: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  last_contacted_at: z.string().optional(),
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
