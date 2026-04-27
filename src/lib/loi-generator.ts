import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  Packer,
  BorderStyle,
} from "docx";
import type { Deal, Contact } from "@/lib/validations";
import type { PurchaseAssumptions } from "@/lib/underwriting";

interface LOIData {
  deal: Deal;
  purchase: PurchaseAssumptions;
  contacts: Contact[];
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
  const { deal, purchase, contacts } = data;

  const price = purchase.bid_price || purchase.loi_amount || purchase.purchase_price;
  const earnest = purchase.earnest_money || 0;
  const ddDays = purchase.due_diligence_days || 45;
  const closingDays = purchase.closing_days || 60;
  const loiDate = purchase.loi_date;
  const buyer = purchase.buyer_entity || "Monument Equity LLC";

  const seller = contacts.find((c) => c.type === "seller");
  const sellerLabel = seller ? contactName(seller) : "[SELLER NAME]";
  const sellerWithCo = seller
    ? `${contactName(seller)}${seller.company ? `, ${seller.company}` : ""}`
    : "[SELLER NAME]";

  const addr = `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`.trim();
  const units = deal.units;
  const pType = deal.property_type || "multifamily";
  const state = STATE_NAMES[deal.state] || deal.state;
  const county = deal.county || `[COUNTY]`;

  const expDate = purchase.loi_expiration
    ? formatDate(purchase.loi_expiration)
    : addDaysDate(loiDate, 10);

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
      n(` as earnest money ("Deposit") into an escrow account with a mutually agreed-upon title company. The Deposit shall be fully refundable during the Due Diligence Period and shall remain refundable to Buyer if (i) Buyer terminates due to title or survey objections that Seller fails to cure, (ii) the Financing Contingency is not satisfied, (iii) Seller defaults under the PSA, or (iv) the conditions precedent in Section 8 are not satisfied. The Deposit shall become non-refundable only upon expiration of the Due Diligence Period and satisfaction or waiver of the Financing Contingency, except as otherwise provided in the PSA.`),
    ], 200),

    // 3. Due Diligence Period
    heading("3. Due Diligence Period"),
    p([
      n(`Buyer shall have a period of ${daysText(ddDays)} days (the "Due Diligence Period") commencing on the later of (i) the Effective Date and (ii) Buyer's receipt of all Seller deliverables listed in Section 9. Buyer shall have a one-time right, exercisable by written notice prior to expiration, to extend the Due Diligence Period by an additional fifteen (15) days. During the Due Diligence Period, Buyer may conduct physical inspections, environmental and engineering assessments, title and survey review, financial and operational review, lease audits, and any other investigations Buyer deems necessary. Buyer may terminate the PSA for any reason during the Due Diligence Period, in which case the Deposit shall be returned to Buyer in full.`),
    ], 200),

    // 4. Financing Contingency
    heading("4. Financing Contingency"),
    p([
      n(`Buyer's obligation to close shall be contingent upon Buyer obtaining acquisition financing on commercially reasonable terms, including a loan-to-value ratio of approximately 65–75% and customary multifamily underwriting terms. Buyer shall use commercially reasonable efforts to secure a loan commitment within ${daysText(ddDays)} days of the Effective Date. If Buyer is unable to obtain a binding loan commitment by such date, Buyer may terminate the PSA and the Deposit shall be returned in full.`),
    ], 200),

    // 5. Closing Timeline
    heading("5. Closing Timeline"),
    p([
      n(`Closing shall occur within ${daysText(closingDays)} days after the later of (i) expiration of the Due Diligence Period and (ii) satisfaction or waiver of the Financing Contingency. Closing shall take place at the offices of a mutually-agreed, licensed title company.`),
    ], 200),

    // 6. Exclusivity / No-Shop
    heading("6. Exclusivity / No-Shop"),
    p([
      n(`From the Effective Date through the earlier of (i) ${daysText(ddDays)} days thereafter or (ii) execution of the PSA, Seller agrees that neither Seller nor any of its affiliates, agents, or representatives shall directly or indirectly solicit, initiate, encourage, negotiate, or accept any offer, inquiry, or proposal from any third party regarding the sale, transfer, refinancing, or encumbrance of the Property. Seller shall promptly notify Buyer of any such unsolicited inquiry.`),
    ], 200),

    // 7. Assignment
    heading("7. Assignment"),
    p([
      n(`Buyer may, at or prior to Closing, assign its rights and obligations under this LOI and the resulting PSA to any entity controlled by, controlling, or under common control with ${buyer}, including without limitation a single-purpose entity formed for the acquisition in any jurisdiction selected by Buyer, without Seller's consent. Such assignment shall not relieve Buyer of its obligations until Closing.`),
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
    spacer(),

    // 9. Seller Deliverables During Due Diligence
    heading("9. Seller Deliverables During Due Diligence"),
    p([n("Within five (5) business days of the Effective Date, Seller shall deliver to Buyer the following:")]),
    bullet("Trailing 12-month (T12) operating statements and trailing 3 years of annual operating statements"),
    bullet("Current rent roll, certified by Seller, including lease terms, deposits, concessions, and delinquencies"),
    bullet("Copies of all existing leases, lease amendments, addenda, and rental applications"),
    bullet("Property tax bills and insurance policies for the trailing 3 years"),
    bullet("Capital expenditure history (trailing 5 years) and pending work orders"),
    bullet("All service contracts, vendor agreements, warranties, and equipment leases"),
    bullet("Existing environmental reports, surveys, title policies, appraisals, and inspection reports"),
    bullet("Utility bills for the trailing 12 months"),
    bullet("Schedule of personal property included in the sale"),
    bullet("Any pending litigation, code violations, or governmental notices affecting the Property"),
    spacer(),

    // 10. Operating Covenants During Contract
    heading("10. Operating Covenants During Contract"),
    p([n("From the Effective Date through Closing, Seller shall operate the Property in the ordinary course consistent with past practice and shall not, without Buyer's prior written consent (not to be unreasonably withheld):")]),
    bullet("Enter into, modify, terminate, or extend any lease for a term greater than 12 months or at below-market rents"),
    bullet("Enter into any new service contract not terminable on 30 days' notice without penalty"),
    bullet("Undertake any non-emergency capital expenditures or material alterations"),
    bullet("Apply or refund tenant security deposits other than in the ordinary course"),
    bullet("Encumber the Property with any new lien, mortgage, easement, or restriction"),
    bullet("Settle, compromise, or initiate any litigation affecting the Property"),
    spacer(),

    // 11. Closing Economics and Prorations
    heading("11. Closing Economics and Prorations"),
    p([n("At Closing, the following shall be prorated as of 11:59 p.m. on the day prior to Closing:")]),
    bullet("Rent (collected only), real estate taxes, utilities, and operating expenses"),
    bullet("Tenant security deposits (and any interest thereon) shall be credited to Buyer at Closing"),
    bullet("Prepaid rent shall be credited to Buyer; delinquent rent shall be addressed in the PSA"),
    p([n(`Closing costs shall be allocated in accordance with ${county} County, ${state} custom. Seller shall pay the ${state} real estate transfer tax, the cost of a standard owner's title insurance policy, and one-half of escrow fees. Buyer shall pay recording fees, the cost of any lender's title policy, survey costs, and one-half of escrow fees. Each party shall bear its own attorneys' fees.`)], 200),

    // 12. Title and Survey Review
    heading("12. Title and Survey Review"),
    p([n("Seller shall deliver a current title commitment and underlying exception documents within five (5) business days of the Effective Date. Buyer shall have ten (10) business days from receipt of the later of the title commitment or the survey to deliver written objections to Seller. Seller shall have ten (10) business days to notify Buyer in writing whether Seller will cure such objections. If Seller declines or fails to cure, Buyer may (i) waive the objection and proceed, or (ii) terminate the PSA and receive a full refund of the Deposit.")], 200),

    // 13. Wire Fraud Prevention
    heading("13. Wire Fraud Prevention and Closing Funds Protocol"),
    p([n("All wire instructions shall be issued solely by the title company on its official letterhead, transmitted via secure channel, and verbally verified by Buyer with a known officer of the title company at a telephone number obtained independently from the title company's public records (and not from any email, attachment, or unverified communication). The parties shall not honor any change to wire instructions communicated by email. Closing funds shall be disbursed only to the Seller of record as identified in the title commitment, and only upon recording of the deed.")], 200),

    // 14. Proof of Funds and Buyer Qualifications
    heading("14. Proof of Funds and Buyer Qualifications"),
    p([n("Upon execution of the PSA, Buyer shall provide:")]),
    bullet("Proof of equity funds sufficient for the cash portion of the acquisition"),
    bullet("Lender pre-qualification or term sheet (if financing is used)"),
    bullet("Buyer entity formation documents and authorized signatory evidence"),
    bullet("Brief portfolio summary and prior multifamily transaction history"),
    spacer(),

    // 15. Non-Binding Nature
    heading("15. Non-Binding Nature"),
    p([n("This Letter of Intent is a non-binding expression of interest and does not constitute a contract or agreement to purchase. Neither party shall have any legal obligation arising from this LOI, except for the Exclusivity (Section 6) and Confidentiality (Section 16) provisions, which shall be binding upon execution. A binding obligation to purchase or sell shall arise only upon the execution of a mutually acceptable PSA.")], 200),

    // 16. Confidentiality
    heading("16. Confidentiality"),
    p([n("Both parties agree to maintain the confidentiality of this LOI and the terms contained herein. Neither party shall disclose the existence or terms of this LOI to any third party without the prior written consent of the other party, except as required by law or to their respective advisors, lenders, attorneys, accountants, prospective investors, and lenders, each of whom shall be bound by equivalent confidentiality obligations.")], 200),

    // 17. Governing Law
    heading("17. Governing Law"),
    p([n(`This LOI and the resulting PSA shall be governed by and construed in accordance with the laws of the State of ${state}, without regard to its conflicts of law principles.`)], 200),

    // 18. LOI Expiration
    heading("18. LOI Expiration"),
    p([
      n(`This Letter of Intent shall expire at 5:00 p.m. Eastern Time on `),
      b(expDate),
      n(` unless accepted by Seller in writing prior to that time.`),
    ], 300),

    // Closing
    p([n("We look forward to the opportunity to acquire this property and are prepared to move expeditiously toward a mutually agreeable transaction. Please contact us with any questions.")], 300),

    // Signature
    p([n("Respectfully submitted,")]),
    spacer(400),

    // Buyer sig
    sigLine(),
    p([b("Buyer: "), n(buyer)]),
    p([b("By: "), ph("[Authorized Signatory Name and Title]")]),
    p([b("Date: "), n(formatDate(loiDate))], 300),

    // Accepted
    p([b("ACCEPTED AND AGREED:")]),
    spacer(400),

    // Seller sig
    sigLine(),
    p([b("Seller: "), n(sellerWithCo)]),
    p([b("By: "), ph("[Authorized Signatory Name and Title]")]),
    p([b("Date: "), ph("[Date]")]),
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

function p(children: TextRun[], after = 100): Paragraph {
  return new Paragraph({ spacing: { after }, children });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, font: H_FONT, size: 24 })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 50 },
    children: [n(text)],
  });
}

function spacer(after = 200): Paragraph {
  return new Paragraph({ spacing: { after }, children: [] });
}

function sigLine(): Paragraph {
  return new Paragraph({
    spacing: { after: 50 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000", space: 1 } },
    children: [],
  });
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
