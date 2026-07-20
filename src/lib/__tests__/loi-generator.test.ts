/**
 * LOI generator (loi-template-fixes-spec.md). The .docx is a zip; we extract
 * word/document.xml and assert on its text so the conditional clauses, address,
 * earnest sizing, and financing window are verified end-to-end.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { generateLOI } from "../loi-generator";
import type { Deal, Contact, Scenario } from "../validations";
import type { PurchaseAssumptions } from "../underwriting";

async function loiText(opts: {
  deal?: Partial<Deal>;
  purchase?: Partial<PurchaseAssumptions>;
  contacts?: Contact[];
  scenario?: Partial<Scenario>;
}): Promise<string> {
  const deal = {
    id: "d1", address: "934 E Gay St", city: "Columbus", state: "OH", zip: "43203",
    units: 25, asking_price: 3_100_000, source: "broker", ...opts.deal,
  } as unknown as Deal;
  const purchase = { purchase_price: 3_100_000, closing_cost_rate: 0.02, earnest_money: 0, ...opts.purchase } as unknown as PurchaseAssumptions;
  const buf = await generateLOI({ deal, purchase, contacts: opts.contacts ?? [], scenario: opts.scenario as Scenario | undefined });
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")!.async("string");
  // Strip tags → plain text for substring assertions.
  return xml.replace(/<[^>]+>/g, "");
}

describe("LOI — item 1: address & parcel", () => {
  it("prints the parcel ID and county alternate site address", async () => {
    const t = await loiText({ deal: { county: "Franklin", parcel_number: "010-050496-00", county_site_address: "943 E Almond Aly" } });
    expect(t).toContain("Franklin County Parcel ID 010-050496-00");
    expect(t).toContain("also identified in county records as 943 E Almond Aly");
    expect(t).toContain("43203"); // site ZIP, not an owner ZIP
  });
});

describe("LOI — item 2: earnest money", () => {
  it("computes 1% of price with a $25k floor when not overridden", async () => {
    // $3.1M × 1% = $31,000 (above the $25k floor).
    const t = await loiText({ purchase: { earnest_money: 0 } });
    expect(t).toContain("$31,000");
    expect(t).toContain("% of the purchase price");
  });

  it("applies the $25k floor on small deals", async () => {
    const t = await loiText({ deal: { asking_price: 1_000_000 }, purchase: { purchase_price: 1_000_000, earnest_money: 0 } });
    expect(t).toContain("$25,000"); // 1% = $10k → floored to $25k
  });

  it("honors an explicit override", async () => {
    const t = await loiText({ purchase: { earnest_money: 50_000 } });
    expect(t).toContain("$50,000");
  });
});

describe("LOI — item 3: financing window by loan type", () => {
  it("agency / unspecified → 75 days", async () => {
    const t = await loiText({ scenario: { financing_assumptions: { loan_type: "agency" } } as Partial<Scenario> });
    expect(t).toContain("seventy-five (75) days");
  });
  it("bank → 60 days", async () => {
    const t = await loiText({ scenario: { financing_assumptions: { loan_type: "bank" } } as Partial<Scenario> });
    expect(t).toContain("sixty (60) days");
  });
});

describe("LOI — item 4: conditional incentive clauses", () => {
  it("inserts CRA deliverable, condition, and covenant with the granting authority", async () => {
    const t = await loiText({ deal: { incentive_type: "CRA", granting_authority: "the City of Columbus" } });
    expect(t).toContain("CRA tax abatement agreement");
    expect(t).toContain("the City of Columbus");
    expect(t).toMatch(/remains in full force and effect, transfers to and survives conveyance/);
    expect(t).toMatch(/jeopardize, reduce, impair, or accelerate the expiration/);
  });

  it("uses PILOT language for TIF/PILOT", async () => {
    const t = await loiText({ deal: { incentive_type: "PILOT" } });
    expect(t).toContain("PILOT payment schedule");
  });

  it("omits all incentive clauses when there is no incentive", async () => {
    const t = await loiText({});
    expect(t).not.toContain("tax abatement agreement");
    expect(t).not.toContain("PILOT payment schedule");
  });

  it("adds the RUBS deliverable only when the scenario carries RUBS", async () => {
    const withRubs = await loiText({ scenario: { revenue_assumptions: { rubs: { mode: "structured" } } } as Partial<Scenario> });
    expect(withRubs).toContain("Utility reimbursement/RUBS billing methodology");
    const without = await loiText({});
    expect(without).not.toContain("Utility reimbursement/RUBS billing methodology");
  });
});

describe("LOI — item 5/6: polish", () => {
  it("attaches proof of funds when toggled", async () => {
    const t = await loiText({ purchase: { attach_proof_of_funds: true } });
    expect(t).toContain("Buyer encloses with this Letter of Intent proof of funds");
  });
  it("renders the new acceptance block with a Month, Day/Year placeholder", async () => {
    const t = await loiText({});
    expect(t).toContain("ACCEPTED AND AGREED:");
    expect(t).toContain("[Month, Day/Year]");
  });
});

describe("LOI — revised template clauses", () => {
  it("adds the new / expanded standard clauses", async () => {
    const t = (await loiText({})).replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
    // §3 access, §4 financing-through-closing, §5 closing extension
    expect(t).toContain("reasonable access to the Property, upon reasonable prior notice");
    expect(t).toContain("Financing Contingency shall remain in effect through Closing");
    expect(t).toContain("successive periods of thirty (30) days each by releasing");
    // §7 broadened assignment + release
    expect(t).toContain("to a partnership, corporation, or other party");
    expect(t).toContain("Buyer shall be released from any further liability");
    // §8 rent-ready + notwithstanding
    expect(t).toContain("all units in rent-ready condition at Closing");
    expect(t).toContain("Buyer shall have no obligation to close, until all contingencies");
    // §9 expanded deliverables
    expect(t).toContain("Operating bank statements for the trailing two (2) years");
    expect(t).toContain("Schedule E from Seller's federal tax returns");
    expect(t).toContain("payoff letter from each current lender");
    // §10 sole-discretion consent
    expect(t).toContain("sole and absolute discretion as to any lease");
    // §12 mandatory cure items
    expect(t).toContain("Mandatory Cure Items");
  });

  it("inserts §16 Absence of Violations and renumbers 17–20 with the corrected cross-reference", async () => {
    const t = await loiText({});
    expect(t).toContain("16. Absence of Violations");
    expect(t).toContain("17. Non-Binding Nature");
    expect(t).toContain("18. Confidentiality");
    expect(t).toContain("19. Governing Law");
    expect(t).toContain("20. LOI Expiration");
    // Non-Binding now points at Confidentiality's new section number.
    expect(t).toContain("Confidentiality (Section 18)");
    // No stale numbering left behind.
    expect(t).not.toContain("16. Non-Binding");
    expect(t).not.toContain("19. LOI Expiration ");
  });
});
