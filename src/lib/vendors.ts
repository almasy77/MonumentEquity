/**
 * Vendors directory — service providers Monument Equity uses across deals
 * (cost segregation, lenders, inspectors, attorneys, insurance, title, PMs…).
 *
 * Storage (Redis, same pattern as contacts):
 *   vendor:<id>                       Vendor JSON (offerings embedded)
 *   vendors:all                       ZSET of vendor ids
 *   deal_vendor:<id>                  DealVendor JSON (a vendor linked to a deal, with quote)
 *   deal_vendors:by_deal:<dealId>     ZSET of deal_vendor ids
 *   deal_vendors:by_vendor:<vendorId> ZSET of deal_vendor ids
 *   vendors:seeded:v1                 flag — starter vendors written once (deleting them sticks)
 *
 * People (brokers, loan officers) stay in Contacts; a vendor can point at them
 * via contact_ids instead of duplicating names/phones here.
 *
 * Pure helpers in this file (eligibility, budgets) carry no Redis import so they
 * can be unit-tested and used client-side.
 */

import { z } from "zod";
import { DEAL_STAGES, type DealStage } from "./constants";

export const VENDOR_CATEGORIES = [
  "cost_segregation",
  "lender",
  "broker",
  "property_manager",
  "inspector",
  "attorney",
  "insurance",
  "title",
  "contractor",
  "other",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  cost_segregation: "Cost Segregation",
  lender: "Lender",
  broker: "Broker",
  property_manager: "Property Manager",
  inspector: "Inspector",
  attorney: "Attorney",
  insurance: "Insurance",
  title: "Title",
  contractor: "Contractor",
  other: "Other",
};

export const VENDOR_STATUSES = ["untested", "quoted", "engaged", "used", "do_not_use"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  untested: "Untested",
  quoted: "Quoted",
  engaged: "Engaged",
  used: "Used",
  do_not_use: "Do Not Use",
};

export const DEAL_VENDOR_STATUSES = ["requested", "received", "accepted", "declined"] as const;
export type DealVendorStatus = (typeof DEAL_VENDOR_STATUSES)[number];

export const DEAL_VENDOR_STATUS_LABELS: Record<DealVendorStatus, string> = {
  requested: "Quote requested",
  received: "Quote received",
  accepted: "Accepted",
  declined: "Declined",
};

export interface VendorOffering {
  id: string;
  name: string;
  price_from?: number | null; // null/undefined = quote only
  price_notes?: string;
  turnaround?: string;
  max_purchase_price?: number | null; // null = no cap
  max_renovation_spend?: number | null; // null = no cap
  property_types?: string;
  audit_protection_included?: boolean;
  audit_protection_price?: number | null;
  source_url?: string;
  source_checked_date?: string; // YYYY-MM-DD
}

export interface Vendor {
  id: string;
  name: string;
  company?: string;
  category: VendorCategory;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  contact_ids?: string[]; // links to Contacts
  markets: string[]; // e.g. ["Nationwide"], ["Columbus OH"]
  stage_triggers: DealStage[]; // deal stages where this vendor is suggested
  status: VendorStatus;
  rating?: number | null; // 1–5
  notes?: string;
  offerings: VendorOffering[];
  seed_key?: string; // set on starter vendors
  created_at: string;
  updated_at: string;
}

export interface DealVendor {
  id: string;
  deal_id: string;
  vendor_id: string;
  offering_id?: string;
  role?: string;
  quote_amount?: number | null;
  quote_date?: string;
  status: DealVendorStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ─── Eligibility ─────────────────────────────────────────────

export type EligibilityVerdict = "eligible" | "ineligible" | "unknown";

export interface OfferingEligibility {
  verdict: EligibilityVerdict;
  reasons: string[];
}

const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Check one offering against a deal's purchase price and renovation spend.
 * A cap that is null/undefined never disqualifies. A cap that is set but the
 * deal figure is unknown yields "unknown" (rather than a false "eligible").
 */
export function offeringEligibility(
  offering: Pick<VendorOffering, "max_purchase_price" | "max_renovation_spend">,
  deal: { purchasePrice?: number | null; renovationSpend?: number | null },
): OfferingEligibility {
  const reasons: string[] = [];
  let unknown = false;
  let fail = false;

  const checks: Array<[number | null | undefined, number | null | undefined, string]> = [
    [offering.max_purchase_price, deal.purchasePrice, "purchase price"],
    [offering.max_renovation_spend, deal.renovationSpend, "renovation spend"],
  ];
  for (const [cap, value, label] of checks) {
    if (cap == null) continue;
    if (value == null || !Number.isFinite(value)) {
      unknown = true;
      reasons.push(`${label} unknown (cap ${fmtUsd(cap)})`);
    } else if (value >= cap) {
      fail = true;
      reasons.push(`${label} ${fmtUsd(value)} is at or over the ${fmtUsd(cap)} cap`);
    }
  }

  if (fail) return { verdict: "ineligible", reasons };
  if (unknown) return { verdict: "unknown", reasons };
  return { verdict: "eligible", reasons };
}

/** Best available purchase price for a deal: final → bid → asking. */
export function dealPurchasePrice(deal: {
  final_purchase_price?: number | null;
  bid_price?: number | null;
  asking_price?: number | null;
}): number | null {
  for (const v of [deal.final_purchase_price, deal.bid_price, deal.asking_price]) {
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

interface CapexLike {
  per_unit_enabled?: boolean;
  per_unit_cost?: number;
  units_to_renovate?: number;
  renovation_lines?: Array<{ per_unit_cost?: number; units_to_renovate?: number }>;
  projects?: Array<{ cost?: number; enabled?: boolean }>;
}

/**
 * Renovation spend from a scenario's capex assumptions: per-unit renovation
 * lines (or the legacy single line) plus enabled named projects. Excludes the
 * probabilistic capital reserve and replacement reserves, which are not
 * renovation work a cost-seg vendor prices. Returns null when no capex exists.
 */
export function renovationSpendFromCapex(capex: CapexLike | null | undefined): number | null {
  if (!capex) return null;
  let total = 0;
  if (capex.per_unit_enabled !== false) {
    const lines = capex.renovation_lines && capex.renovation_lines.length > 0
      ? capex.renovation_lines
      : [{ per_unit_cost: capex.per_unit_cost, units_to_renovate: capex.units_to_renovate }];
    for (const l of lines) total += (l.per_unit_cost || 0) * (l.units_to_renovate || 0);
  }
  for (const p of capex.projects ?? []) {
    if (p.enabled === false) continue;
    total += p.cost || 0;
  }
  return total;
}

/** Vendors to suggest for a deal stage (active, not flagged do-not-use). */
export function suggestedVendorsForStage(vendors: Vendor[], stage: DealStage, linkedVendorIds: string[]): Vendor[] {
  const linked = new Set(linkedVendorIds);
  return vendors.filter(
    (v) => v.status !== "do_not_use" && !linked.has(v.id) && (v.stage_triggers ?? []).includes(stage),
  );
}

// ─── Starter vendors (checked 2026-10-30 against each vendor's website) ──

const CHECKED = "2026-10-30";

export const SEED_VENDORS: Array<Omit<Vendor, "id" | "created_at" | "updated_at">> = [
  {
    seed_key: "cost-seg-ez",
    name: "Cost Seg EZ",
    company: "MVO Consulting LLC (sister brand of MVO Cost Segregation)",
    category: "cost_segregation",
    website: "https://costsegez.com/",
    markets: ["Nationwide"],
    stage_triggers: ["closing", "onboarding"],
    status: "untested",
    notes:
      "Software-first with engineer tiers. Cheap tiers cap at $1M purchase price, so most Monument deals need Fully Engineered. Audit protection is a $195 add-on below Fully Engineered.",
    offerings: [
      {
        id: "csez-diy",
        name: "DIY",
        price_from: 595,
        turnaround: "Instant",
        max_purchase_price: 1_000_000,
        max_renovation_spend: 10_000,
        property_types: "Residential, excluding condos",
        audit_protection_included: false,
        audit_protection_price: 195,
        source_url: "https://costsegez.com/",
        source_checked_date: CHECKED,
      },
      {
        id: "csez-engineer-reviewed",
        name: "Engineer Reviewed",
        price_from: 895,
        turnaround: "3-5 business days",
        max_purchase_price: 1_000_000,
        max_renovation_spend: 100_000,
        property_types: "Any residential",
        audit_protection_included: false,
        audit_protection_price: 195,
        source_url: "https://costsegez.com/",
        source_checked_date: CHECKED,
      },
      {
        id: "csez-fully-engineered",
        name: "Fully Engineered",
        price_from: 2_250,
        price_notes: "Starts at $2,250; priced on property complexity",
        turnaround: "3-4 weeks",
        max_purchase_price: null,
        max_renovation_spend: null,
        property_types: "Any property",
        audit_protection_included: true,
        source_url: "https://costsegez.com/",
        source_checked_date: CHECKED,
      },
    ],
  },
  {
    seed_key: "maven-cost-seg",
    name: "Maven Cost Segregation",
    company: "Maven Cost Segregation Tax Advisors (founder Sean Graham, CPA)",
    category: "cost_segregation",
    website: "https://www.mavencostseg.com",
    markets: ["Nationwide"],
    stage_triggers: ["closing", "onboarding"],
    status: "untested",
    notes:
      "Engineer-led studies with physical or virtual site inspection; free proposal, most estimates within 24 hours. Also offers a free REPS hour tracker (repstracker.mavencostseg.com). Reclassification and review figures on its site are marketing claims.",
    offerings: [
      {
        id: "maven-detailed-engineering",
        name: "Detailed Engineering Cost Segregation Study",
        price_from: null,
        price_notes: "Quote only (free proposal)",
        turnaround: "Within 30 days of site visit",
        max_purchase_price: null,
        max_renovation_spend: null,
        property_types: "Multifamily, commercial, self-storage, STR, hospitality, retail",
        audit_protection_included: true,
        source_url: "https://www.mavencostseg.com/our-services/detailed-engineering-cost-segregation-studies/",
        source_checked_date: CHECKED,
      },
      {
        id: "maven-form-3115",
        name: "IRS Form 3115 Preparation",
        price_from: null,
        price_notes: "Quote only. Catch-up depreciation for property already in service.",
        max_purchase_price: null,
        max_renovation_spend: null,
        source_url: "https://www.mavencostseg.com/our-services/irs-form-3115-preparation/",
        source_checked_date: CHECKED,
      },
    ],
  },
];

// ─── Input validation (API) ──────────────────────────────────

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => u === "" || /^https?:\/\//i.test(u), "Must start with http:// or https://");

const money = z.number().finite().nonnegative().nullable().optional();

export const vendorOfferingInputSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  price_from: money,
  price_notes: z.string().max(500).optional(),
  turnaround: z.string().max(100).optional(),
  max_purchase_price: money,
  max_renovation_spend: money,
  property_types: z.string().max(300).optional(),
  audit_protection_included: z.boolean().optional(),
  audit_protection_price: money,
  source_url: httpUrl.optional(),
  source_checked_date: z.string().max(10).optional(),
});

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().max(200).optional(),
  category: z.enum(VENDOR_CATEGORIES),
  contact_name: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(200).optional(),
  website: httpUrl.optional(),
  contact_ids: z.array(z.string().max(80)).max(50).optional(),
  markets: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  stage_triggers: z.array(z.enum(DEAL_STAGES)).max(DEAL_STAGES.length).default([]),
  status: z.enum(VENDOR_STATUSES).default("untested"),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(5000).optional(),
  offerings: z.array(vendorOfferingInputSchema).max(30).default([]),
});
export type VendorInput = z.infer<typeof vendorInputSchema>;

export const dealVendorInputSchema = z.object({
  vendor_id: z.string().min(1).max(80),
  offering_id: z.string().max(80).optional(),
  role: z.string().max(200).optional(),
  quote_amount: money,
  quote_date: z.string().max(10).optional(),
  status: z.enum(DEAL_VENDOR_STATUSES).default("requested"),
  notes: z.string().max(2000).optional(),
});
