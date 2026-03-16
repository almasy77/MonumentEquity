/**
 * Default checklist templates for Screening, Due Diligence, Closing, and Onboarding.
 * Based on the Durham First-Deal Playbook.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  completed: boolean;
  completed_at?: string;
  notes?: string;
}

export interface ChecklistInstance {
  id: string;
  deal_id: string;
  type: "screening" | "diligence" | "closing" | "onboarding";
  items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

// ─── Screening Checklist (from playbook) ────────────────────

export const SCREENING_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Location
  { id: "sc-01", label: "Is the neighborhood one of your approved target areas?", category: "Location" },
  { id: "sc-02", label: "Would you still want to own it if rent growth stays flat?", category: "Location" },
  // Deal Shape
  { id: "sc-03", label: "Is unit count within buy box range (6–20)?", category: "Deal Shape" },
  { id: "sc-04", label: "Is the value-add plan visible within 12 months?", category: "Deal Shape" },
  { id: "sc-05", label: "Is the physical scope light enough to control?", category: "Deal Shape" },
  // Financials
  { id: "sc-06", label: "Do you have a real T-12 and current rent roll?", category: "Financials" },
  { id: "sc-07", label: "Are taxes / insurance / payroll assumptions believable?", category: "Financials" },
  { id: "sc-08", label: "Does the deal still work under conservative DSCR?", category: "Financials" },
  { id: "sc-09", label: "Do you understand exactly how NOI improves?", category: "Financials" },
  // Physical
  { id: "sc-10", label: "Does the business plan avoid heavy rehab / unknown systems?", category: "Physical" },
  { id: "sc-11", label: "Are roofs, plumbing, electrical, and drainage reasonably clear?", category: "Physical" },
  // Tenants
  { id: "sc-12", label: "Are collections stable enough for a first deal?", category: "Tenants" },
  { id: "sc-13", label: "Is the tenant profile manageable, not chaotic?", category: "Tenants" },
  // Seller
  { id: "sc-14", label: "Do seller records feel organized and truthful?", category: "Seller" },
  // Exit
  { id: "sc-15", label: "Is there a plausible refinance / exit path?", category: "Exit" },
  // Discipline
  { id: "sc-16", label: "Are you pursuing because it fits, not because you're afraid to miss a deal?", category: "Discipline" },
];

// ─── Due Diligence (from playbook workstreams) ──────────────

export const DD_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Broker / Seller Questions
  { id: "dd-01", label: "Why is the seller selling now?", category: "Broker / Seller" },
  { id: "dd-02", label: "What has been the hardest thing about operating the asset?", category: "Broker / Seller" },
  { id: "dd-03", label: "What is the real story behind under-market rents or vacancies?", category: "Broker / Seller" },
  { id: "dd-04", label: "What surprised prior buyers or lenders?", category: "Broker / Seller" },
  { id: "dd-05", label: "What sort of buyer should NOT buy this deal?", category: "Broker / Seller" },
  { id: "dd-06", label: "What is the real obstacle to pushing rents or occupancy?", category: "Broker / Seller" },
  // Financial Diligence
  { id: "dd-07", label: "T-12 financials received and reviewed", category: "Financial" },
  { id: "dd-08", label: "Reconcile T-12 to trailing bank statements / collections", category: "Financial" },
  { id: "dd-09", label: "Rent roll received and verified", category: "Financial" },
  { id: "dd-10", label: "Bad debt, concessions, and nonrecurring repairs identified", category: "Financial" },
  { id: "dd-11", label: "Post-sale taxes and insurance estimated", category: "Financial" },
  { id: "dd-12", label: "Utility bills reviewed (12 months)", category: "Financial" },
  { id: "dd-13", label: "Tax returns reviewed (2 years)", category: "Financial" },
  { id: "dd-14", label: "Insurance loss history reviewed", category: "Financial" },
  // Physical Diligence
  { id: "dd-15", label: "Property inspection scheduled", category: "Physical" },
  { id: "dd-16", label: "Property inspection completed", category: "Physical" },
  { id: "dd-17", label: "Roof age and remaining life assessed", category: "Physical" },
  { id: "dd-18", label: "HVAC age and remaining life assessed", category: "Physical" },
  { id: "dd-19", label: "Plumbing lines assessed", category: "Physical" },
  { id: "dd-20", label: "Electrical panels assessed", category: "Physical" },
  { id: "dd-21", label: "Water heaters assessed", category: "Physical" },
  { id: "dd-22", label: "Water intrusion / sewer backups / drainage checked", category: "Physical" },
  { id: "dd-23", label: "Deferred maintenance identified and costed", category: "Physical" },
  { id: "dd-24", label: "Environmental Phase I ordered", category: "Physical" },
  { id: "dd-25", label: "Environmental Phase I received", category: "Physical" },
  { id: "dd-26", label: "Survey ordered", category: "Physical" },
  { id: "dd-27", label: "Survey received", category: "Physical" },
  // Tenant Diligence
  { id: "dd-28", label: "Tenant profile reviewed — who lives here and why?", category: "Tenants" },
  { id: "dd-29", label: "Collections stability reviewed by unit and by month", category: "Tenants" },
  { id: "dd-30", label: "Unrecorded concessions, side deals, or problem residents identified", category: "Tenants" },
  // Legal Diligence
  { id: "dd-31", label: "Title search ordered", category: "Legal" },
  { id: "dd-32", label: "Title report received and reviewed", category: "Legal" },
  { id: "dd-33", label: "Code violations, permits, zoning nonconformities checked", category: "Legal" },
  { id: "dd-34", label: "Easements and encroachments reviewed", category: "Legal" },
  { id: "dd-35", label: "Unsettled claims, tenant disputes, open liens checked", category: "Legal" },
  { id: "dd-36", label: "Lease audit completed", category: "Legal" },
  // Management Readiness
  { id: "dd-37", label: "Could a third-party PM take this over immediately?", category: "Management" },
  { id: "dd-38", label: "Tasks hardest to systematize in first 90 days identified", category: "Management" },
  { id: "dd-39", label: "PM interviewed — where is the pro forma too optimistic?", category: "Management" },
  // Inspector / Contractor
  { id: "dd-40", label: "Most likely hidden capital item identified", category: "Inspector" },
  { id: "dd-41", label: "Priority fix list created (if this were your money)", category: "Inspector" },
  // Lender
  { id: "dd-42", label: "Lender comfortable with leverage and reserve levels", category: "Lender" },
  { id: "dd-43", label: "Lender's least-comfortable assumption identified", category: "Lender" },
  // Attorney
  { id: "dd-44", label: "Attorney reviewed title, survey, zoning, permits, leases, disclosures", category: "Attorney" },
  { id: "dd-45", label: "Potential close delays or post-close risks flagged", category: "Attorney" },
];

// ─── Closing ────────────────────────────────────────────────

export const CLOSING_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Financing
  { id: "cl-01", label: "Loan commitment received", category: "Financing" },
  { id: "cl-02", label: "Appraisal ordered", category: "Financing" },
  { id: "cl-03", label: "Appraisal received", category: "Financing" },
  { id: "cl-04", label: "Loan documents received", category: "Financing" },
  { id: "cl-05", label: "Loan documents reviewed by attorney", category: "Financing" },
  { id: "cl-06", label: "Lender comfortable with leverage and reserve level", category: "Financing" },
  // Legal
  { id: "cl-07", label: "Purchase agreement finalized", category: "Legal" },
  { id: "cl-08", label: "Title insurance commitment received", category: "Legal" },
  { id: "cl-09", label: "Entity formation (LLC/LP)", category: "Legal" },
  { id: "cl-10", label: "Operating agreement finalized", category: "Legal" },
  // Settlement
  { id: "cl-11", label: "Closing date confirmed", category: "Settlement" },
  { id: "cl-12", label: "Proration calculations reviewed", category: "Settlement" },
  { id: "cl-13", label: "Settlement statement reviewed", category: "Settlement" },
  { id: "cl-14", label: "Wire instructions confirmed", category: "Settlement" },
  { id: "cl-15", label: "Post-close reserves confirmed ($100K+ minimum)", category: "Settlement" },
  { id: "cl-16", label: "Funds wired", category: "Settlement" },
  { id: "cl-17", label: "Closing documents signed", category: "Settlement" },
];

// ─── Onboarding / First 100 Days (from playbook) ───────────

export const ONBOARDING_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Days 1–14: Control the Property
  { id: "ob-01", label: "Confirm collections status for every unit", category: "Days 1–14: Control" },
  { id: "ob-02", label: "Inspect every unit in person", category: "Days 1–14: Control" },
  { id: "ob-03", label: "Stabilize tenant communication", category: "Days 1–14: Control" },
  { id: "ob-04", label: "Fix life-safety issues immediately", category: "Days 1–14: Control" },
  { id: "ob-05", label: "Lock vendors (PM, maintenance, emergency)", category: "Days 1–14: Control" },
  { id: "ob-06", label: "Property management agreement signed", category: "Days 1–14: Control" },
  { id: "ob-07", label: "Bank accounts opened", category: "Days 1–14: Control" },
  { id: "ob-08", label: "Insurance policy activated", category: "Days 1–14: Control" },
  { id: "ob-09", label: "Utilities transferred to new owner", category: "Days 1–14: Control" },
  { id: "ob-10", label: "Security deposits transferred", category: "Days 1–14: Control" },
  // Days 15–30: Set the Operating System
  { id: "ob-11", label: "Repair priorities documented and scheduled", category: "Days 15–30: Systems" },
  { id: "ob-12", label: "Unit turn schedule created", category: "Days 15–30: Systems" },
  { id: "ob-13", label: "PM weekly cadence established", category: "Days 15–30: Systems" },
  { id: "ob-14", label: "Weekly KPI reporting set up", category: "Days 15–30: Systems" },
  { id: "ob-15", label: "Leasing standards documented", category: "Days 15–30: Systems" },
  { id: "ob-16", label: "Tenant ledgers set up in PM software", category: "Days 15–30: Systems" },
  { id: "ob-17", label: "Rent payment instructions sent to all tenants", category: "Days 15–30: Systems" },
  // Days 31–60: Start Visible Improvements
  { id: "ob-18", label: "Highest-ROI unit turns started", category: "Days 31–60: Improvements" },
  { id: "ob-19", label: "Common-area optics improved", category: "Days 31–60: Improvements" },
  { id: "ob-20", label: "Maintenance speed improved", category: "Days 31–60: Improvements" },
  { id: "ob-21", label: "Expense cleanup completed", category: "Days 31–60: Improvements" },
  { id: "ob-22", label: "Vendor contracts reviewed/renegotiated", category: "Days 31–60: Improvements" },
  // Days 61–100: Turn Gains into Traction
  { id: "ob-23", label: "Measured rent adjustments implemented", category: "Days 61–100: Traction" },
  { id: "ob-24", label: "Renewal plan for existing tenants created", category: "Days 61–100: Traction" },
  { id: "ob-25", label: "CapEx pacing reviewed vs. plan", category: "Days 61–100: Traction" },
  { id: "ob-26", label: "Refi / hold decision reviewed", category: "Days 61–100: Traction" },
  { id: "ob-27", label: "Acquisition lessons log documented", category: "Days 61–100: Traction" },
  { id: "ob-28", label: "Actual results vs. pro forma documented", category: "Days 61–100: Traction" },
  { id: "ob-29", label: "Monthly reporting cadence set", category: "Days 61–100: Traction" },
];

export function createChecklistFromTemplate(
  type: "screening" | "diligence" | "closing" | "onboarding"
): ChecklistItem[] {
  const templates = {
    screening: SCREENING_TEMPLATE,
    diligence: DD_TEMPLATE,
    closing: CLOSING_TEMPLATE,
    onboarding: ONBOARDING_TEMPLATE,
  };

  return templates[type].map((item) => ({
    ...item,
    completed: false,
  }));
}
