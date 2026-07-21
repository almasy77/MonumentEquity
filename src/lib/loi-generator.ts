import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  Packer,
  BorderStyle,
  TabStopType,
} from "docx";
import type { Deal, Contact, Scenario } from "@/lib/validations";
import type { PurchaseAssumptions, FinancingAssumptions, RevenueAssumptions } from "@/lib/underwriting";

interface LOIData {
  deal: Deal;
  purchase: PurchaseAssumptions;
  contacts: Contact[];
  scenario?: Scenario; // supplies loan type (financing window) + RUBS detection
}

const H_FONT = "DM Serif Display";
const B_FONT = "DM Sans";
const SZ = 22;

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "[DATE]";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function addDaysDate(dateStr: string | undefined, days: number): string {
  if (!dateStr || !days) return "[DATE]";
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Today's local-time date as "YYYY-MM-DD". Using local time (not UTC) so the
// LOI shows the date the user sees on their calendar, not a date that may have
// rolled over to tomorrow in UTC if they're generating it in the evening.
function todayLocalISODate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function b(text: string): TextRun {
  return new TextRun({ text, bold: true, font: B_FONT, size: SZ });
}

function n(text: string): TextRun {
  return new TextRun({ text, font: B_FONT, size: SZ });
}

function it(text: string): TextRun {
  return new TextRun({ text, font: B_FONT, size: SZ, italics: true });
}

function ph(text: string): TextRun {
  return new TextRun({ text, font: B_FONT, size: SZ, color: "808080", italics: true });
}

function contactName(c: Contact): string {
  return `${c.first_name}${c.last_name ? ` ${c.last_name}` : ""}`;
}

function daysText(days: number): string {
  return `${numberToWordsLower(days)} (${days})`;
}

export async function generateLOI(data: LOIData): Promise<Buffer> {
  const { deal, purchase, contacts, scenario } = data;

  const price = purchase.bid_price || purchase.loi_amount || purchase.purchase_price;
  // Earnest money (item 2): honor an explicit override, else size as a % of
  // price clamped to [min, max]. Default 1%, $25k floor, no cap.
  const emPct = purchase.earnest_money_pct ?? 0.01;
  const emMin = purchase.earnest_money_min ?? 25_000;
  const emComputed = Math.max(emMin, Math.round(price * emPct));
  const earnest = (purchase.earnest_money && purchase.earnest_money > 0)
    ? purchase.earnest_money
    : (purchase.earnest_money_max ? Math.min(emComputed, purchase.earnest_money_max) : emComputed);
  const ddDays = purchase.due_diligence_days || 45;
  const closingDays = purchase.closing_days || 60;
  // Exclusivity / no-shop window (§6): its own period, NOT tied to the DD days.
  // Default 60 so the no-shop covers DD plus PSA negotiation.
  const exclusivityDays = purchase.exclusivity_days || 60;
  // Financing-contingency window (item 3): independent of DD; defaulted by loan
  // type (agency runs long: appraisal + Phase I + PCA + agency underwriting).
  const fin = (scenario?.financing_assumptions ?? {}) as Partial<FinancingAssumptions>;
  const financingDays = fin.financing_contingency_days ?? (
    fin.loan_type === "bank" || fin.loan_type === "portfolio" ? 60
      : fin.loan_type === "bridge" || fin.loan_type === "cash" ? 45
      : 75 // agency or unspecified
  );
  // Default to today's date when the user hasn't explicitly set one. An explicit
  // value is respected (e.g. backdating, regenerating an existing LOI revision).
  const loiDate = purchase.loi_date || todayLocalISODate();
  const buyer = purchase.buyer_entity || "Monument Equity LLC";

  const seller = contacts.find((c) => c.type === "seller");
  const sellerLabel = seller ? contactName(seller) : "[SELLER NAME]";
  const sellerWithCo = seller
    ? `${contactName(seller)}${seller.company ? `, ${seller.company}` : ""}`
    : "[SELLER NAME]";

  // Property address (item 1): ALWAYS from the parcel/site fields, never the
  // owner mailing address. Print the parcel ID, and the county's alternate site
  // address when it differs from the marketed address.
  const baseAddr = `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`.trim();
  const countyName = deal.county ? `${deal.county} County ` : "";
  const parcelBit = deal.parcel_number ? `${countyName}Parcel ID ${deal.parcel_number}` : "";
  const altBit = deal.county_site_address?.trim() && deal.county_site_address.trim() !== deal.address.trim()
    ? `also identified in county records as ${deal.county_site_address.trim()}`
    : "";
  const parens = [parcelBit, altBit].filter(Boolean).join(", ");
  const addr = parens ? `${baseAddr} (${parens})` : baseAddr;
  // Data-source guardrail: the property ZIP should come from the parcel, not the
  // owner's mailing address.
  if (deal.zip && deal.owner_mailing_address?.includes(deal.zip)) {
    console.warn(`[LOI] Property ZIP ${deal.zip} also appears in the owner mailing address — verify the site ZIP is from the parcel/listing record, not the owner record.`);
  }

  // Tax incentive (item 4) + RUBS (item 4b) detection.
  const incentiveType = deal.incentive_type; // CRA | TIF | PILOT | LIHTC | undefined
  const grantingAuthority = deal.granting_authority?.trim() || "the applicable granting authority";
  const isPilot = incentiveType === "TIF" || incentiveType === "PILOT";
  const incomeRestricted = incentiveType === "LIHTC";
  const rev = (scenario?.revenue_assumptions ?? {}) as Partial<RevenueAssumptions>;
  const hasRubs = !!(
    rev.rubs?.mode === "structured" ||
    rev.other_income?.line_items?.some((li) => li.kind === "rubs") ||
    (rev.other_income_sublines?.utility_reimbursement ?? 0) > 0
  );

  const units = deal.units;
  const pType = deal.property_type || "multifamily";
  const state = STATE_NAMES[deal.state] || deal.state;

  const expDate = purchase.loi_expiration
    ? formatDate(purchase.loi_expiration)
    : addDaysDate(loiDate, 10);

  // ── Conditional tax-incentive clauses (item 4) ──
  const incLabel = incentiveType ?? "";
  const abatementWord = isPilot ? "incentive (PILOT)" : "tax abatement";
  const incentiveDeliverables: Paragraph[] = incentiveType
    ? [bullet(isPilot
        ? `The executed ${incLabel} agreement and all amendments, the PILOT payment schedule, and all annual compliance filings and correspondence with ${grantingAuthority} regarding the incentive.`
        : `The executed ${incLabel} tax abatement agreement and all amendments, together with all annual compliance filings, tenant income certifications, and correspondence with ${grantingAuthority} regarding the abatement.`)]
    : [];
  // RUBS deliverable — whenever the model carries RUBS income (item 4b).
  const rubsDeliverable: Paragraph[] = hasRubs
    ? [bullet(`Utility reimbursement/RUBS billing methodology and trailing 12-month billed-versus-collected detail, together with the lease provisions authorizing the utility pass-through.`)]
    : [];
  // Income-restricted lease-audit scope (item 5).
  const incomeRestrictedDD: Paragraph[] = incomeRestricted
    ? [bullet(`Tenant income certifications and rent-cap compliance documentation for Buyer's verification (note: utility reimbursements/RUBS count toward the rent cap).`)]
    : [];
  const incentiveCondition: Paragraph[] = incentiveType
    ? [bullet(`Written confirmation from ${grantingAuthority} that the ${incLabel} ${abatementWord} on the Property remains in full force and effect, transfers to and survives conveyance to Buyer, and that Buyer is able to maintain compliance; and that no compliance default, clawback, reduction, or revocation is pending or threatened.`)]
    : [];
  const incentiveCovenant: Paragraph[] = incentiveType
    ? [bullet(`Take or omit any action that would jeopardize, reduce, impair, or accelerate the expiration of the ${incLabel} ${abatementWord}, or cause the Property to fall out of compliance with its terms (including required income certifications and annual filings).`)]
    : [];
  const proofOfFunds: Paragraph[] = purchase.attach_proof_of_funds
    ? [p([n(`Buyer encloses with this Letter of Intent proof of funds and/or a lender pre-qualification evidencing Buyer's financial capability to consummate the transaction.`)], 200)]
    : [];

  const children: Paragraph[] = [
    // Title
    para(AlignmentType.CENTER, { after: 100 }, [
      new TextRun({ text: "LETTER OF INTENT", bold: true, font: H_FONT, size: 32 }),
    ]),
    para(AlignmentType.CENTER, { after: 100 }, [
      new TextRun({ text: "Non-Binding Expression of Interest", font: B_FONT, size: SZ, italics: true, color: "666666" }),
    ]),
    para(AlignmentType.CENTER, { after: 400 }, [], { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 10 } }),

    // Header fields
    p([b("Date: "), n(formatDate(loiDate))]),
    p([b("Effective Date: "), it("The date this LOI is countersigned by Seller")]),
    p([b("To: "), n(sellerLabel)]),
    p([b("From: "), n(buyer)]),
    para(AlignmentType.LEFT, { after: 300 }, [b("Re: "), n(`Letter of Intent — ${addr}`)]),

    // Dear
    p([n(`Dear ${sellerLabel},`)], 200),

    // Intro
    p([
      n(`${buyer} ("Buyer") is pleased to submit this non-binding Letter of Intent to purchase the ${units}-unit ${pType} property located at `),
      b(addr),
      n(` ("Property"). This LOI outlines the principal terms under which Buyer would acquire the Property, subject to the negotiation and execution of a mutually acceptable Purchase and Sale Agreement ("PSA").`),
    ], 200),

    // 1. Purchase Price
    heading("1. Purchase Price"),
    p([
      n(`The proposed purchase price shall be `),
      b(fmt(price)),
      n(` (${numberToWords(price)} Dollars), payable in cash and/or a combination of cash and third-party financing at Closing.`),
    ], 200),

    // 2. Earnest Money Deposit
    heading("2. Earnest Money Deposit"),
    p([
      n(`Within three (3) business days of the full execution of the PSA, Buyer shall deposit `),
      b(fmt(earnest)),
      n(`${price > 0 ? ` (approximately ${(earnest / price * 100).toFixed(1)}% of the purchase price)` : ""} as earnest money ("Deposit") into an escrow account with a mutually agreed-upon title company. The Deposit shall be fully refundable during the Due Diligence Period and shall remain refundable to Buyer if (i) Buyer terminates due to title or survey objections that Seller fails to cure, (ii) the Financing Contingency is not satisfied, (iii) Seller defaults under the PSA, or (iv) the conditions precedent in Section 8 are not satisfied. The Deposit shall become non-refundable only upon expiration of the Due Diligence Period and satisfaction or waiver of the Financing Contingency, except as otherwise provided in the PSA.`),
    ], 200),

    // 3. Due Diligence Period
    heading("3. Due Diligence Period"),
    p([
      n(`Buyer shall have a period of ${daysText(ddDays)} days (the "Due Diligence Period") commencing on the later of (i) the Effective Date and (ii) Buyer's receipt of all Seller deliverables listed in Section 9. Buyer shall have a one-time right, exercisable by written notice prior to expiration, to extend the Due Diligence Period by an additional fifteen (15) days. During the Due Diligence Period, Buyer may conduct physical inspections, environmental and engineering assessments, title and survey review, financial and operational review, lease audits, and any other investigations Buyer deems necessary. Seller shall provide Buyer and its agents, lenders, inspectors, and consultants reasonable access to the Property, upon reasonable prior notice, throughout the Due Diligence Period, including access to units and building systems and, subject to applicable law and existing leases, the right to interview tenants and the property manager. Buyer may terminate the PSA for any reason during the Due Diligence Period, in which case the Deposit shall be returned to Buyer in full.`),
    ], 200),

    // 4. Financing Contingency
    heading("4. Financing Contingency"),
    p([
      n(`Buyer's obligation to close shall be contingent upon Buyer obtaining acquisition financing on commercially reasonable terms, including a loan-to-value ratio of approximately 65–75% and customary multifamily underwriting terms. Buyer shall use commercially reasonable efforts to secure a loan commitment within ${daysText(financingDays)} days of the Effective Date. If Buyer is unable to obtain a binding loan commitment by such date, Buyer may terminate the PSA and the Deposit shall be returned in full. The Financing Contingency shall remain in effect through Closing, and if, despite Buyer's commercially reasonable efforts, Buyer's committed financing fails to fund for any reason other than Buyer's default, Buyer may terminate the PSA and the Deposit shall be returned to Buyer in full.`),
    ], 200),

    // 5. Closing Timeline
    heading("5. Closing Timeline"),
    p([
      n(`Closing shall occur within ${daysText(closingDays)} days after the later of (i) expiration of the Due Diligence Period and (ii) satisfaction or waiver of the Financing Contingency. Closing shall take place at the offices of a mutually-agreed, licensed title company. Buyer shall have the right to extend the Closing date by one or more successive periods of thirty (30) days each by releasing to the title company, for each such extension, an additional amount equal to one-quarter of one percent (0.25%) of the purchase price, which additional deposit shall be applied to the purchase price at Closing and shall be in addition to the Deposit, which Buyer shall maintain in full at all times.`),
    ], 200),

    // 6. Exclusivity / No-Shop
    heading("6. Exclusivity / No-Shop"),
    p([
      n(`From the Effective Date through the earlier of (i) ${daysText(exclusivityDays)} days thereafter or (ii) execution of the PSA, Seller agrees that neither Seller nor any of its affiliates, agents, or representatives shall directly or indirectly solicit, initiate, encourage, negotiate, or accept any offer, inquiry, or proposal from any third party regarding the sale, transfer, refinancing, or encumbrance of the Property. Seller shall promptly notify Buyer of any such unsolicited inquiry.`),
    ], 200),

    // 7. Assignment
    heading("7. Assignment"),
    p([
      n(`Buyer may, at or prior to Closing, assign its rights and obligations under this LOI and the resulting PSA to a partnership, corporation, or other party, including without limitation a single-purpose entity formed for the acquisition in any jurisdiction selected by Buyer, without Seller's consent, and any such assignee shall have all of the benefits, rights, privileges, covenants, conditions, and obligations of Buyer under this LOI and the PSA. Upon such assignment and the assignee's written assumption of Buyer's obligations, Buyer shall be released from any further liability hereunder.`),
    ], 200),

    // 8. Conditions Precedent to Closing
    heading("8. Conditions Precedent to Closing"),
    p([n("Buyer's obligation to close shall be contingent upon, among other customary conditions:")]),
    bullet("Satisfactory completion of due diligence, in Buyer's sole discretion"),
    bullet("Delivery of clear and marketable title, free of liens and material encumbrances, and a current ALTA survey acceptable to Buyer and its lender"),
    bullet("Delivery of executed tenant estoppel certificates from no fewer than eighty percent (80%) of tenants, in form reasonably acceptable to Buyer and its lender"),
    bullet("Receipt of all necessary third-party approvals, consents, and lender approvals"),
    bullet("No material adverse change in the physical, financial, or legal condition of the Property between the Effective Date and Closing"),
    bullet("Continued accuracy of Seller's representations and warranties as of Closing"),
    bullet("Receipt of a satisfactory Phase I Environmental Site Assessment and, if recommended, Phase II"),
    bullet("Delivery of all units in rent-ready condition at Closing, meaning each unit is clean and free of debris, with all appliances, plumbing, electrical, HVAC, and other building systems in good working order, and no unit uninhabitable or under repair, except as disclosed to and accepted by Buyer in writing"),
    ...incentiveCondition,
    p([n("Notwithstanding anything to the contrary, Closing shall not occur, and Buyer shall have no obligation to close, until all contingencies and conditions precedent set forth in this LOI and the PSA have been satisfied or waived in writing by Buyer.")], 200),

    // 9. Seller Deliverables During Due Diligence
    heading("9. Seller Deliverables During Due Diligence"),
    p([n("Within five (5) business days of the Effective Date, Seller shall deliver to Buyer the following:")]),
    bullet("Trailing 12-month (T12) operating statements and trailing 3 years of annual operating statements"),
    bullet("Current rent roll, certified by Seller, setting forth for each unit the rental rate, security deposit, lease term, concessions, unit type, and lease commencement and expiration dates, together with a payment history for each tenant for the trailing six (6) months (including any late payments and amounts currently owed) and identification of any evictions in progress"),
    bullet("Copies of all existing leases, lease amendments, addenda, and rental applications"),
    bullet("Property tax bills for the trailing 3 years, and all insurance policies for the trailing 3 years together with insurance carrier contact information"),
    bullet("Capital expenditure history (trailing 5 years) and pending work orders"),
    bullet("All service contracts, vendor agreements, and equipment leases, each showing the contract term, monthly cost, scope of work performed, and any termination penalty, including without limitation contracts for pest control, trash removal, landscaping, janitorial service, parking lot sweeping, snow removal, and security"),
    bullet("Existing environmental reports, surveys, title policies, appraisals, and inspection reports"),
    bullet("Utility bills for the trailing 12 months"),
    bullet("A written inventory of all furnishings and personal property in, on, or used in the normal operation and maintenance of the Property, identifying any personal property that will not convey"),
    bullet("Any pending litigation, code violations, or governmental notices affecting the Property"),
    bullet("Trailing two (2) years' profit and loss statements or summary of operating expenses"),
    bullet("Operating bank statements for the trailing two (2) years"),
    bullet("Schedule E from Seller's federal tax returns for the trailing two (2) years"),
    bullet("Current property management agreement"),
    bullet("As-built surveys showing any improvements to the Property"),
    bullet("Owner's title insurance binder or policy"),
    bullet("All notes, trust deeds, mortgages, and other documents relating to title to, or liens or debts against, the Property, together with a current title insurance commitment"),
    bullet("A statement or payoff letter from each current lender showing the outstanding balance and terms of each mortgage or loan encumbering the Property"),
    bullet("Copies of all warranties for appliances, equipment, utilities, roof, paving, pool, and similar items"),
    ...incentiveDeliverables,
    ...rubsDeliverable,
    ...incomeRestrictedDD,
    spacer(),

    // 10. Operating Covenants During Contract
    heading("10. Operating Covenants During Contract"),
    p([n("From the Effective Date through Closing, Seller shall operate the Property in the ordinary course consistent with past practice and shall not, without Buyer's prior written consent (which consent may be granted or withheld in Buyer's sole and absolute discretion as to any lease, rental agreement, or service contract, and which shall otherwise not be unreasonably withheld):")]),
    bullet("Enter into, modify, terminate, extend, or renew any lease, rental agreement, or tenancy"),
    bullet("Enter into, modify, extend, or terminate any service contract, vendor agreement, or equipment lease"),
    bullet("Undertake any non-emergency capital expenditures or material alterations"),
    bullet("Apply or refund tenant security deposits other than in the ordinary course"),
    bullet("Encumber the Property with any new lien, mortgage, easement, or restriction"),
    bullet("Settle, compromise, or initiate any litigation affecting the Property"),
    ...incentiveCovenant,
    spacer(),

    // 11. Closing Economics and Prorations
    heading("11. Closing Economics and Prorations"),
    p([n("At Closing, the following shall be prorated as of 11:59 p.m. on the day prior to Closing:")]),
    bullet("Rent (collected only), real estate taxes, utilities, and operating expenses"),
    bullet("Tenant security deposits (and any interest thereon) shall be credited to Buyer at Closing"),
    bullet("Prepaid rent shall be credited to Buyer; delinquent rent shall be addressed in the PSA"),
    p([n(`Closing costs shall be allocated in accordance with local custom in the county and state in which the Property is located. Seller shall pay any applicable state, county, or municipal real estate transfer taxes, the cost of a standard owner's title insurance policy, and any escrow fees. Buyer shall pay recording fees, the cost of any lender's title policy, and survey costs. Each party shall bear its own attorneys' fees.`)], 200),

    // 12. Title and Survey Review
    heading("12. Title and Survey Review"),
    p([n("Seller shall deliver a current title commitment and underlying exception documents within five (5) business days of the Effective Date. Buyer shall have ten (10) business days from receipt of the later of the title commitment or the survey to deliver written objections to Seller. Seller shall have ten (10) business days to notify Buyer in writing whether Seller will cure such objections. If Seller declines or fails to cure, Buyer may (i) waive the objection and proceed, or (ii) terminate the PSA and receive a full refund of the Deposit. Notwithstanding the foregoing, Seller shall cure and remove, at or prior to Closing and at Seller's sole expense, all mortgages, deeds of trust, mechanic's and materialmen's liens, judgment liens, delinquent taxes, and other monetary liens or encumbrances of an ascertainable amount (collectively, \"Mandatory Cure Items\"), whether or not Buyer objects to them.")], 200),

    // 13. Wire Fraud Prevention
    heading("13. Wire Fraud Prevention and Closing Funds Protocol"),
    p([n("All wire instructions shall be issued solely by the title company on its official letterhead, transmitted via secure channel, and verbally verified by Buyer with a known officer of the title company at a telephone number obtained independently from the title company's public records (and not from any email, attachment, or unverified communication). The parties shall not honor any change to wire instructions communicated by email. Closing funds shall be disbursed only to the Seller of record as identified in the title commitment, and only upon recording of the deed.")], 200),

    // 14. Remedies
    heading("14. Remedies"),
    p([
      b("(a) Buyer Default. "),
      n(`If, following expiration of the Due Diligence Period and satisfaction or waiver of the Financing Contingency, Buyer fails to consummate the purchase of the Property in breach of the PSA, Seller's sole and exclusive remedy at law or in equity shall be to retain the Deposit, together with any accrued interest, as full and final liquidated damages. The parties acknowledge that actual damages resulting from Buyer's default would be difficult or impossible to determine, and that the Deposit represents a reasonable estimate of such damages. Seller expressly waives any right to specific performance, consequential, special, or punitive damages, and any other remedy at law or in equity arising from such default. The foregoing shall not limit Buyer's obligations under any indemnification, confidentiality, or property-restoration covenants that expressly survive termination.`),
    ], 200),
    p([
      b("(b) Seller Default. "),
      n(`If Seller fails to consummate the sale of the Property in breach of the PSA, or otherwise materially defaults under the PSA, Buyer shall have the right, at its sole election, to: (i) terminate the PSA, in which case the Deposit shall be promptly returned to Buyer in full, and Seller shall reimburse Buyer for actual, documented third-party due diligence costs and expenses incurred in connection with the transaction, up to a cap of `),
      b("$50,000"),
      n(`; or (ii) pursue specific performance of Seller's obligation to convey the Property, provided that any action for specific performance must be commenced within `),
      b("ninety (90) days"),
      n(` following the scheduled Closing date. Buyer's rights under this Section 14(b) shall be cumulative with any other rights or remedies expressly reserved to Buyer under the PSA, except that Buyer waives any claim for consequential, special, or punitive damages.`),
    ], 200),

    // 15. Proof of Funds and Buyer Qualifications
    heading("15. Proof of Funds and Buyer Qualifications"),
    p([n("Upon execution of the PSA, Buyer shall provide:")]),
    bullet("Proof of equity funds sufficient for the cash portion of the acquisition"),
    bullet("Lender pre-qualification or term sheet (if financing is used)"),
    bullet("Buyer entity formation documents and authorized signatory evidence"),
    bullet("Brief portfolio summary and prior multifamily transaction history"),
    ...proofOfFunds,
    spacer(),

    // 16. Absence of Violations
    heading("16. Absence of Violations"),
    p([n("To the best of Seller's knowledge, no part of the Property is in violation of any applicable code, health, or safety regulation, and the Property is not the subject of any governmental or judicial proceeding. Seller is not aware of any structural defects or adverse geological or environmental conditions affecting the Property or its value. In the event Buyer discovers, whether during or after the Due Diligence Period, that any such violation, proceeding, defect, or condition exists and is material to the transaction, Buyer may, at its election, terminate the PSA and receive a full refund of the Deposit or negotiate an adjustment to the terms of the transaction.")], 200),

    // 17. Non-Binding Nature
    heading("17. Non-Binding Nature"),
    p([n("This Letter of Intent is a non-binding expression of interest and does not constitute a contract or agreement to purchase. Neither party shall have any legal obligation arising from this LOI, except for the Exclusivity (Section 6) and Confidentiality (Section 18) provisions, which shall be binding upon execution. A binding obligation to purchase or sell shall arise only upon the execution of a mutually acceptable PSA.")], 200),

    // 18. Confidentiality
    heading("18. Confidentiality"),
    p([n("Both parties agree to maintain the confidentiality of this LOI and the terms contained herein. Neither party shall disclose the existence or terms of this LOI to any third party without the prior written consent of the other party, except as required by law or to their respective advisors, lenders, attorneys, accountants, prospective investors, and lenders, each of whom shall be bound by equivalent confidentiality obligations.")], 200),

    // 19. Governing Law
    heading("19. Governing Law"),
    p([n(`This LOI and the resulting PSA shall be governed by and construed in accordance with the laws of the State of ${state}, without regard to its conflicts of law principles.`)], 200),

    // 20. LOI Expiration
    heading("20. LOI Expiration"),
    p([
      n(`This Letter of Intent shall expire at 5:00 p.m. Eastern Time on `),
      b(expDate),
      n(` unless accepted by Seller in writing prior to that time.`),
    ], 300),

    // Closing
    p([n("We look forward to the opportunity to acquire this property and are prepared to move expeditiously toward a mutually agreeable transaction. Please contact us with any questions.")], 300),

    // ── Signature block (item 6) ──
    // signatureOnNewPage (default true): start the sign-off on a fresh page.
    new Paragraph({
      spacing: { before: 400, after: 200 },
      keepNext: true, keepLines: true, widowControl: true,
      pageBreakBefore: purchase.signature_on_new_page !== false,
      children: [n("Respectfully submitted,")],
    }),

    // Buyer block
    sigRow("Signed:", n("__________________________________"), { before: 400 }),
    sigRow("Buyer:", n(buyer)),
    sigRow("By:", ph(`[Authorized Signatory Name and Title]`)),
    sigRow("Date:", n(formatDate(loiDate)), { after: 300 }),

    // Acceptance block
    new Paragraph({
      spacing: { before: 400, after: 100 },
      keepNext: true, keepLines: true, widowControl: true,
      children: [b("ACCEPTED AND AGREED:")],
    }),
    sigRow("Signed:", n("________________________________________")),
    sigRow("Seller:", n(seller ? sellerWithCo : "________________________________________")),
    sigRow("By:", n("________________________________________")),
    pKept([ph("[Authorized Signatory Name and Title]")]),
    sigRow("Date:", n("________________________________________")),
    pKept([ph("[Month, Day/Year]")]),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: B_FONT, size: SZ } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

// ── Helpers ──

function para(
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType],
  spacing: { before?: number; after?: number },
  children: TextRun[],
  border?: Record<string, unknown>,
): Paragraph {
  return new Paragraph({ alignment, spacing, children, border });
}

// widowControl on every paragraph (item 6b) — no single line orphaned across a
// page break.
function p(children: TextRun[], after = 100): Paragraph {
  return new Paragraph({ spacing: { after }, widowControl: true, children });
}

// keepNext on Heading 2 (item 6b) — a section heading never ends a page alone.
function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    keepNext: true,
    widowControl: true,
    children: [new TextRun({ text, bold: true, font: H_FONT, size: 24 })],
  });
}

// keepLines on list items (item 6b) — a clause does not split across a page.
function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 50 },
    keepLines: true,
    widowControl: true,
    children: [n(text)],
  });
}

function spacer(after = 200): Paragraph {
  return new Paragraph({ spacing: { after }, children: [] });
}

// A signature row: bold label, tab, value — kept together and with the next row
// so the whole block never splits across a page (item 6).
function sigRow(label: string, value: TextRun, spacing: { before?: number; after?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 100, ...spacing },
    keepLines: true,
    keepNext: true,
    widowControl: true,
    tabStops: [{ type: TabStopType.LEFT, position: 1440 }],
    children: [b(label), new TextRun({ text: "\t", font: B_FONT, size: SZ }), value],
  });
}

// Paragraph kept with the next (for the [name/title] and [date] placeholder
// lines that follow a signature row).
function pKept(children: TextRun[]): Paragraph {
  return new Paragraph({ spacing: { after: 100 }, keepLines: true, keepNext: true, widowControl: true, children });
}

// ── Number to words ──

function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  return toWords(Math.floor(num));
}

function numberToWordsLower(num: number): string {
  return toWords(num).toLowerCase();
}

function toWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Million", "Billion"];

  function chunk(c: number): string {
    if (c === 0) return "";
    if (c < 20) return ones[c];
    if (c < 100) return tens[Math.floor(c / 10)] + (c % 10 ? "-" + ones[c % 10] : "");
    return ones[Math.floor(c / 100)] + " Hundred" + (c % 100 ? " " + chunk(c % 100) : "");
  }

  const parts: string[] = [];
  let scaleIdx = 0;
  let remaining = num;
  while (remaining > 0) {
    const c = remaining % 1000;
    if (c > 0) parts.unshift(chunk(c) + (scales[scaleIdx] ? " " + scales[scaleIdx] : ""));
    remaining = Math.floor(remaining / 1000);
    scaleIdx++;
  }
  return parts.join(" ");
}
