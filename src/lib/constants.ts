export const DEAL_STAGES = [
  "lead",
  "screening",
  "analysis",
  "loi",
  "due_diligence",
  "closing",
  "onboarding",
  "stabilized",
] as const;

export const DEAL_TERMINAL_STATUSES = ["dead", "passed"] as const;

export type DealStage = (typeof DEAL_STAGES)[number];
export type DealTerminalStatus = (typeof DEAL_TERMINAL_STATUSES)[number];
export type DealStatus = "active" | "dead" | "passed";

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Lead",
  screening: "Screening",
  analysis: "Analysis",
  loi: "LOI",
  due_diligence: "Due Diligence",
  closing: "Closing",
  onboarding: "Onboarding",
  stabilized: "Stabilized",
};

export const STAGE_STALE_DAYS: Record<DealStage, number> = {
  lead: 3,
  screening: 5,
  analysis: 7,
  loi: 3,
  due_diligence: 5,
  closing: 3,
  onboarding: 14,
  stabilized: 30,
};

export const DEAL_SOURCES = [
  "Broker",
  "LoopNet",
  "CoStar",
  "Crexi",
  "Direct Mail",
  "Off-Market",
  "Referral",
  "Driving for Dollars",
  "Other",
] as const;

export const CONTACT_TYPES = [
  "broker",
  "seller",
  "lender",
  "attorney",
  "property_manager",
  "contractor",
  "other",
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  broker: "Broker",
  seller: "Seller",
  lender: "Lender",
  attorney: "Attorney",
  property_manager: "Property Manager",
  contractor: "Contractor",
  other: "Other",
};

export const SCENARIO_TYPES = [
  "base",
  "upside",
  "downside",
  "value_add",
  "sale",
  "custom",
] as const;

export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export const SCENARIO_TYPE_LABELS: Record<ScenarioType, string> = {
  base: "Base Case",
  upside: "Upside",
  downside: "Downside",
  value_add: "Value-Add",
  sale: "Sale",
  custom: "Custom",
};

export const DEFAULT_ASSUMPTIONS = {
  vacancy_rate: 0.07,
  bad_debt_rate: 0.02,
  concessions_rate: 0,
  management_fee_rate: 0.08,
  repairs_maintenance_per_unit: 750,
  insurance_per_unit: 600,
  tax_escalation_rate: 0.02,
  rent_growth_rate: 0.03,
  exit_cap_rate_spread: 0.005,
  hold_period_years: 5, // 3–7 year range per playbook
  reserves_per_unit: 300,
  turnover_cost_per_unit: 500,
  utilities_per_unit: 1200,
  admin_legal_marketing: 0,
  contract_services: 0,
  ltv: 0.75,
  interest_rate: 0.065,
  amortization_years: 30,
  loan_term_years: 5,
  io_period_months: 0,
  origination_fee_rate: 0.01,
  closing_cost_rate: 0.02,
  selling_cost_rate: 0.02,
} as const;

// Buy Box guardrails from Durham First-Deal Playbook
export const BUY_BOX = {
  target_units: 12,
  min_units: 6,
  max_units: 20,
  max_rehab_per_unit: 20000,
  min_dscr: 1.25,
  min_yield_on_cost: 0.08,
  min_neighborhood_score: 6.75,
  min_cash_reserve_after_close: 100000,
  asset_condition: "B-/C+ with light-to-moderate value-add only",
  work_scope: "Cosmetic upgrades, management cleanup, collections, expense reset",
  avoid: "Heavy rehab, severe distress, structural uncertainty, chaotic records",
  hold_period: "3–7 years",
  decision_rule: "Only buy a deal that is understandable, fixable, and financeable",
} as const;

// Durham neighborhood data from playbook
export const DURHAM_NEIGHBORHOODS = [
  { name: "Lakewood / West End", zip: "27707 / 27701", score: 8.35, tier: 1, basis: 364650, yoy: 0.006 },
  { name: "Walltown", zip: "27701", score: 7.85, tier: 1, basis: 352615, yoy: 0.016 },
  { name: "Parkwood / South Durham", zip: "27713", score: 7.40, tier: 1, basis: 356093, yoy: -0.029 },
  { name: "Old East Durham", zip: "27701 / 27703", score: 7.30, tier: 2, basis: 282503, yoy: -0.060 },
  { name: "Duke Park", zip: "27701", score: 6.50, tier: 2, basis: 471058, yoy: -0.036 },
  { name: "Old West Durham", zip: "27705", score: 6.45, tier: 3, basis: 499284, yoy: -0.019 },
  { name: "Cleveland-Holloway", zip: "27701", score: 6.15, tier: 3, basis: 520522, yoy: 0.021 },
  { name: "Morehead Hill", zip: "27701", score: 5.95, tier: 3, basis: 508854, yoy: -0.030 },
  { name: "Trinity Park", zip: "27701", score: 5.35, tier: 4, basis: 654127, yoy: -0.016 },
  { name: "Old North Durham", zip: "27701", score: 5.25, tier: 4, basis: 536670, yoy: -0.022 },
] as const;

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const USER_ROLES = ["admin", "va", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];
