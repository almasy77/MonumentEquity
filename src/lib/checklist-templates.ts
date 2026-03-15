/**
 * Default checklist templates for Due Diligence, Closing, and Onboarding.
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
  type: "diligence" | "closing" | "onboarding";
  items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

export const DD_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Property
  { id: "dd-01", label: "Property inspection scheduled", category: "Property" },
  { id: "dd-02", label: "Property inspection completed", category: "Property" },
  { id: "dd-03", label: "Roof inspection", category: "Property" },
  { id: "dd-04", label: "HVAC assessment", category: "Property" },
  { id: "dd-05", label: "Plumbing assessment", category: "Property" },
  { id: "dd-06", label: "Electrical assessment", category: "Property" },
  { id: "dd-07", label: "Environmental Phase I ordered", category: "Property" },
  { id: "dd-08", label: "Environmental Phase I received", category: "Property" },
  { id: "dd-09", label: "Survey ordered", category: "Property" },
  { id: "dd-10", label: "Survey received", category: "Property" },
  // Financial
  { id: "dd-11", label: "T-12 financials received", category: "Financial" },
  { id: "dd-12", label: "Rent roll received and verified", category: "Financial" },
  { id: "dd-13", label: "Utility bills reviewed (12 months)", category: "Financial" },
  { id: "dd-14", label: "Tax returns reviewed (2 years)", category: "Financial" },
  { id: "dd-15", label: "Insurance loss history reviewed", category: "Financial" },
  // Legal
  { id: "dd-16", label: "Title search ordered", category: "Legal" },
  { id: "dd-17", label: "Title report received and reviewed", category: "Legal" },
  { id: "dd-18", label: "Lease audit completed", category: "Legal" },
  { id: "dd-19", label: "Zoning and permits verified", category: "Legal" },
  { id: "dd-20", label: "HOA/CC&R review (if applicable)", category: "Legal" },
];

export const CLOSING_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Financing
  { id: "cl-01", label: "Loan commitment received", category: "Financing" },
  { id: "cl-02", label: "Appraisal ordered", category: "Financing" },
  { id: "cl-03", label: "Appraisal received", category: "Financing" },
  { id: "cl-04", label: "Loan documents received", category: "Financing" },
  { id: "cl-05", label: "Loan documents reviewed by attorney", category: "Financing" },
  // Legal
  { id: "cl-06", label: "Purchase agreement finalized", category: "Legal" },
  { id: "cl-07", label: "Title insurance commitment received", category: "Legal" },
  { id: "cl-08", label: "Entity formation (LLC/LP)", category: "Legal" },
  { id: "cl-09", label: "Operating agreement finalized", category: "Legal" },
  // Settlement
  { id: "cl-10", label: "Closing date confirmed", category: "Settlement" },
  { id: "cl-11", label: "Proration calculations reviewed", category: "Settlement" },
  { id: "cl-12", label: "Settlement statement reviewed", category: "Settlement" },
  { id: "cl-13", label: "Wire instructions confirmed", category: "Settlement" },
  { id: "cl-14", label: "Funds wired", category: "Settlement" },
  { id: "cl-15", label: "Closing documents signed", category: "Settlement" },
];

export const ONBOARDING_TEMPLATE: Omit<ChecklistItem, "completed" | "completed_at" | "notes">[] = [
  // Operations
  { id: "ob-01", label: "Property management agreement signed", category: "Operations" },
  { id: "ob-02", label: "Bank accounts opened", category: "Operations" },
  { id: "ob-03", label: "Insurance policy activated", category: "Operations" },
  { id: "ob-04", label: "Utilities transferred to new owner", category: "Operations" },
  { id: "ob-05", label: "Vendor contracts reviewed/renegotiated", category: "Operations" },
  // Tenant Relations
  { id: "ob-06", label: "Tenant introduction letter sent", category: "Tenant Relations" },
  { id: "ob-07", label: "Rent payment instructions sent", category: "Tenant Relations" },
  { id: "ob-08", label: "Tenant ledgers set up in PM software", category: "Tenant Relations" },
  { id: "ob-09", label: "Security deposits transferred", category: "Tenant Relations" },
  // Value-Add
  { id: "ob-10", label: "Renovation contractor selected", category: "Value-Add" },
  { id: "ob-11", label: "Renovation timeline finalized", category: "Value-Add" },
  { id: "ob-12", label: "Unit renovation schedule created", category: "Value-Add" },
  { id: "ob-13", label: "Marketing plan for renovated units", category: "Value-Add" },
  // Reporting
  { id: "ob-14", label: "Monthly reporting cadence set", category: "Reporting" },
  { id: "ob-15", label: "First 100-day business plan documented", category: "Reporting" },
];

export function createChecklistFromTemplate(
  type: "diligence" | "closing" | "onboarding"
): ChecklistItem[] {
  const templates = {
    diligence: DD_TEMPLATE,
    closing: CLOSING_TEMPLATE,
    onboarding: ONBOARDING_TEMPLATE,
  };

  return templates[type].map((item) => ({
    ...item,
    completed: false,
  }));
}
