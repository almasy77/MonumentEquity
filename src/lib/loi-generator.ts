import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  TabStopPosition,
  TabStopType,
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

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "[DATE]";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function addDays(dateStr: string | undefined, days: number): string {
  if (!dateStr || !days) return "[DATE]";
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function bold(text: string): TextRun {
  return new TextRun({ text, bold: true, font: "Calibri", size: 22 });
}

function normal(text: string): TextRun {
  return new TextRun({ text, font: "Calibri", size: 22 });
}

function placeholder(text: string): TextRun {
  return new TextRun({ text, font: "Calibri", size: 22, color: "808080", italics: true });
}

export async function generateLOI(data: LOIData): Promise<Buffer> {
  const { deal, purchase, contacts } = data;

  const purchasePrice = purchase.bid_price || purchase.loi_amount || purchase.purchase_price;
  const earnestMoney = purchase.earnest_money || 0;
  const ddDays = purchase.due_diligence_days || 30;
  const closingDays = purchase.closing_days || 60;
  const loiDate = purchase.loi_date;
  const buyerEntity = purchase.buyer_entity || "[BUYER ENTITY NAME]";

  const sellerContact = contacts.find((c) => c.type === "seller");
  const brokerContact = contacts.find((c) => c.type === "broker");

  const sellerName = sellerContact
    ? `${sellerContact.first_name}${sellerContact.last_name ? ` ${sellerContact.last_name}` : ""}`
    : "[SELLER NAME]";
  const sellerCompany = sellerContact?.company || "[SELLER COMPANY]";
  const brokerName = brokerContact
    ? `${brokerContact.first_name}${brokerContact.last_name ? ` ${brokerContact.last_name}` : ""}`
    : undefined;
  const brokerCompany = brokerContact?.company || undefined;

  const propertyDesc = `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`.trim();
  const unitCount = deal.units;
  const propertyType = deal.property_type || "multifamily";

  const ddDeadline = addDays(loiDate, ddDays);
  const closingDeadline = addDays(loiDate, closingDays);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          // Header
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "LETTER OF INTENT", bold: true, font: "Calibri", size: 32 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "Non-Binding Expression of Interest", font: "Calibri", size: 22, italics: true, color: "666666" }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 10 } },
            children: [],
          }),

          // Date & Addressee
          new Paragraph({
            spacing: { after: 100 },
            children: [bold("Date: "), normal(formatDate(loiDate))],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [bold("To: "), normal(`${sellerName}${sellerCompany !== "[SELLER COMPANY]" ? `, ${sellerCompany}` : ""}`)],
          }),
          ...(brokerName
            ? [
                new Paragraph({
                  spacing: { after: 100 },
                  children: [bold("Via: "), normal(`${brokerName}${brokerCompany ? `, ${brokerCompany}` : ""}`)],
                }),
              ]
            : []),
          new Paragraph({
            spacing: { after: 100 },
            children: [bold("From: "), normal(buyerEntity)],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [bold("Re: "), normal(`Letter of Intent — ${propertyDesc}`)],
          }),

          // Intro
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(`Dear ${sellerName},`),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(
                `${buyerEntity} ("Buyer") is pleased to submit this non-binding Letter of Intent to purchase the ${unitCount}-unit ${propertyType} property located at `
              ),
              bold(propertyDesc),
              normal(
                ` ("Property"). This LOI outlines the principal terms under which Buyer would be interested in acquiring the Property, subject to the execution of a mutually acceptable Purchase and Sale Agreement ("PSA").`
              ),
            ],
          }),

          // Section 1: Purchase Price
          sectionHeading("1. Purchase Price"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(`The proposed purchase price shall be `),
              bold(fmt(purchasePrice)),
              normal(` (${numberToWords(purchasePrice)} Dollars), payable in cash and/or a combination of cash and third-party financing at Closing.`),
            ],
          }),

          // Section 2: Earnest Money
          sectionHeading("2. Earnest Money Deposit"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(
                `Within three (3) business days of the full execution of the PSA, Buyer shall deposit `
              ),
              bold(fmt(earnestMoney)),
              normal(
                ` as earnest money ("Deposit") into an escrow account with a mutually agreed-upon title company. The Deposit shall be fully refundable during the Due Diligence Period and shall become non-refundable upon expiration of the Due Diligence Period, except as otherwise provided in the PSA.`
              ),
            ],
          }),

          // Section 3: Due Diligence
          sectionHeading("3. Due Diligence Period"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(`Buyer shall have a period of `),
              bold(`${ddDays} days`),
              normal(
                ` from the effective date of the PSA (the "Due Diligence Period") to conduct its inspections, investigations, and review of the Property, including but not limited to: physical inspections, environmental assessments, title review, survey, financial and operational review, lease audits, and any other investigations Buyer deems necessary. The Due Diligence Period shall expire on or about `
              ),
              bold(ddDeadline),
              normal(
                `. Buyer may terminate the PSA for any reason during the Due Diligence Period, in which case the Deposit shall be returned in full.`
              ),
            ],
          }),

          // Section 4: Closing
          sectionHeading("4. Closing Timeline"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(`Closing shall occur within `),
              bold(`${closingDays} days`),
              normal(
                ` from the effective date of the PSA, or `
              ),
              bold(`${closingDays - ddDays > 0 ? closingDays - ddDays : 15} days`),
              normal(
                ` after the expiration of the Due Diligence Period, whichever is later. The anticipated closing date is on or about `
              ),
              bold(closingDeadline),
              normal(`.`),
            ],
          }),

          // Section 5: Financing
          sectionHeading("5. Proof of Funds & Buyer Qualifications"),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              normal(
                `Buyer is prepared to provide proof of funds and/or lender pre-approval upon execution of the PSA. Buyer's qualifications include:`
              ),
            ],
          }),
          bulletItem("Proof of funds or bank statements demonstrating sufficient equity for the acquisition"),
          bulletItem("Lender pre-approval or financing commitment letter (if applicable)"),
          bulletItem("Buyer's track record and portfolio summary"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              placeholder("[Attach proof of funds documentation or describe buyer qualifications here]"),
            ],
          }),

          // Section 6: Conditions
          sectionHeading("6. Conditions Precedent to Closing"),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              normal("Buyer's obligation to close shall be contingent upon the following:"),
            ],
          }),
          bulletItem("Satisfactory completion of due diligence, at Buyer's sole discretion"),
          bulletItem("Receipt of clear and marketable title, free of material encumbrances"),
          bulletItem("Delivery of estoppel certificates from tenants (if applicable)"),
          bulletItem("Receipt of all necessary third-party approvals and consents"),
          bulletItem("No material adverse change in the condition of the Property prior to Closing"),
          new Paragraph({ spacing: { after: 200 }, children: [] }),

          // Section 7: Seller Deliverables
          sectionHeading("7. Seller Deliverables During Due Diligence"),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              normal("Upon execution of the PSA, Seller shall provide Buyer with access to the following:"),
            ],
          }),
          bulletItem("Trailing 12-month (T12) operating statements and current rent roll"),
          bulletItem("All existing leases and amendments"),
          bulletItem("Property tax bills and insurance policies"),
          bulletItem("Capital expenditure history and pending work orders"),
          bulletItem("Service contracts, warranties, and vendor agreements"),
          bulletItem("Environmental reports, surveys, and inspection reports (if available)"),
          bulletItem("Utility bills for the trailing 12 months"),
          new Paragraph({ spacing: { after: 200 }, children: [] }),

          // Section 8: Non-Binding
          sectionHeading("8. Non-Binding Nature"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(
                `This Letter of Intent is a non-binding expression of interest and does not constitute a contract or agreement to purchase. Neither party shall have any legal obligation arising from this LOI, except for the confidentiality provisions herein. A binding obligation shall arise only upon the execution of a mutually acceptable PSA.`
              ),
            ],
          }),

          // Section 9: Confidentiality
          sectionHeading("9. Confidentiality"),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              normal(
                `Both parties agree to maintain the confidentiality of this LOI and the terms contained herein. Neither party shall disclose the existence or terms of this LOI to any third party without the prior written consent of the other party, except as required by law or to their respective advisors, lenders, and attorneys.`
              ),
            ],
          }),

          // Section 10: Expiration
          sectionHeading("10. LOI Expiration"),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              normal(`This Letter of Intent shall expire on `),
              bold(purchase.loi_expiration ? formatDate(purchase.loi_expiration) : addDays(loiDate, 7)),
              normal(
                ` unless accepted by Seller in writing prior to that date.`
              ),
            ],
          }),

          // Closing paragraph
          new Paragraph({
            spacing: { after: 300 },
            children: [
              normal(
                `We look forward to the opportunity to acquire this property and are prepared to move expeditiously toward a mutually agreeable transaction. Please do not hesitate to contact us with any questions.`
              ),
            ],
          }),

          // Signature block
          new Paragraph({
            spacing: { after: 100 },
            children: [normal("Respectfully submitted,")],
          }),
          new Paragraph({ spacing: { after: 400 }, children: [] }),

          // Buyer signature
          new Paragraph({
            spacing: { after: 50 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000", space: 1 } },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [],
          }),
          new Paragraph({
            spacing: { after: 50 },
            children: [bold("Buyer: "), normal(buyerEntity)],
          }),
          new Paragraph({
            spacing: { after: 50 },
            children: [bold("By: "), placeholder("[Authorized Signatory Name & Title]")],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [bold("Date: "), normal(formatDate(loiDate))],
          }),

          // Accepted line
          new Paragraph({
            spacing: { after: 100 },
            children: [bold("ACCEPTED AND AGREED:")],
          }),
          new Paragraph({ spacing: { after: 400 }, children: [] }),
          new Paragraph({
            spacing: { after: 50 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000", space: 1 } },
            children: [],
          }),
          new Paragraph({
            spacing: { after: 50 },
            children: [bold("Seller: "), normal(`${sellerName}${sellerCompany !== "[SELLER COMPANY]" ? `, ${sellerCompany}` : ""}`)],
          }),
          new Paragraph({
            spacing: { after: 50 },
            children: [bold("By: "), placeholder("[Authorized Signatory Name & Title]")],
          }),
          new Paragraph({
            spacing: { after: 50 },
            children: [bold("Date: "), placeholder("[Date]")],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({ text, bold: true, font: "Calibri", size: 24 }),
    ],
  });
}

function bulletItem(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 50 },
    children: [normal(text)],
  });
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Million", "Billion"];

  function chunk(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + chunk(num % 100) : "");
  }

  const parts: string[] = [];
  let scaleIdx = 0;
  let remaining = Math.floor(n);

  while (remaining > 0) {
    const c = remaining % 1000;
    if (c > 0) {
      parts.unshift(chunk(c) + (scales[scaleIdx] ? " " + scales[scaleIdx] : ""));
    }
    remaining = Math.floor(remaining / 1000);
    scaleIdx++;
  }

  return parts.join(" ");
}
