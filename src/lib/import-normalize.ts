import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import type { RentRollUnit, T12Statement } from "./validations";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  return new Anthropic({ apiKey });
}

// ─── File parsing helpers ──────────────────────────────────

export async function fileToText(
  buffer: ArrayBuffer,
  fileName: string
): Promise<{ text: string; isPdf: boolean }> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv")) {
    const text = new TextDecoder().decode(buffer);
    return { text, isPdf: false };
  }

  if (lower.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as ArrayBuffer);
    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        const vals = row.values as unknown[];
        const cells = vals.slice(1).map((v) => {
          if (v == null) return "";
          if (typeof v === "object" && v !== null) {
            const cell = v as { result?: unknown; text?: string; richText?: { text: string }[] };
            if (cell.result !== undefined) return String(cell.result);
            if (cell.richText) return cell.richText.map((r) => r.text).join("");
            if (cell.text !== undefined) return cell.text;
          }
          return String(v);
        });
        lines.push(cells.join("\t"));
      });
    });
    return { text: lines.join("\n"), isPdf: false };
  }

  if (lower.endsWith(".pdf")) {
    return { text: Buffer.from(buffer).toString("base64"), isPdf: true };
  }

  throw new Error("Unsupported file format. Use CSV, XLSX, or PDF.");
}

// ─── Rent Roll Normalization ───────────────────────────────

const RENT_ROLL_SYSTEM = `You are a commercial real estate data extraction assistant. Parse rent roll data from spreadsheets or documents into structured JSON.

Return ONLY valid JSON — no markdown fences, no commentary.

Rules:
- Extract EVERY unit listed
- Use the unit number/label exactly as shown
- For unit_type, normalize to patterns like "Studio", "1BR/1BA", "2BR/1BA", "2BR/2BA", "3BR/2BA", etc.
- current_rent and market_rent should be MONTHLY amounts
- Status: "occupied", "vacant", "notice_to_vacate", or "down"
- Dates in YYYY-MM-DD format when possible
- Dollar amounts as raw numbers (no formatting)
- If a field is not present, omit it`;

const RENT_ROLL_PROMPT = `Parse this rent roll data and return a JSON array of units:

[
  {
    "unit_number": "string",
    "unit_type": "Studio|1BR/1BA|2BR/1BA|etc",
    "sqft": number,
    "status": "occupied|vacant|notice_to_vacate|down",
    "tenant_name": "string",
    "current_rent": number (monthly),
    "market_rent": number (monthly),
    "other_charges": number (monthly),
    "lease_start": "YYYY-MM-DD",
    "lease_end": "YYYY-MM-DD",
    "move_in_date": "YYYY-MM-DD",
    "security_deposit": number,
    "concessions": number (monthly),
    "notes": "string"
  }
]

Extract EVERY unit. Return ONLY the JSON array.`;

export async function normalizeRentRoll(
  buffer: ArrayBuffer,
  fileName: string
): Promise<RentRollUnit[]> {
  const { text, isPdf } = await fileToText(buffer, fileName);
  const client = getClient();

  const content: Anthropic.Messages.ContentBlockParam[] = isPdf
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: text } },
        { type: "text", text: RENT_ROLL_PROMPT },
      ]
    : [{ type: "text", text: `${RENT_ROLL_PROMPT}\n\nData:\n${text}` }];

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16000,
    system: RENT_ROLL_SYSTEM,
    messages: [{ role: "user", content }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No response from AI");

  let json = block.text.trim();
  const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();

  const parsed = JSON.parse(json) as RentRollUnit[];
  if (!Array.isArray(parsed)) throw new Error("Expected array of units");

  return parsed.map((u) => ({
    ...u,
    status: u.status || "occupied",
  }));
}

// ─── T12 Normalization ─────────────────────────────────────

const T12_SYSTEM = `You are a commercial real estate data extraction assistant. Parse trailing 12-month (T12) operating statements into structured JSON.

Return ONLY valid JSON — no markdown fences, no commentary.

Rules:
- Extract monthly data if available; if only annual totals, create a single entry
- Month format: YYYY-MM (e.g. "2025-01")
- All dollar amounts as positive numbers (expenses are positive, not negative)
- Vacancy loss should be a positive number representing the dollar amount lost
- If a field is not present, omit it
- Break out utility sub-categories when available`;

const T12_PROMPT = `Parse this T12 operating statement and return JSON:

{
  "period_start": "YYYY-MM",
  "period_end": "YYYY-MM",
  "months": [
    {
      "month": "YYYY-MM",
      "gross_potential_rent": number,
      "vacancy_loss": number,
      "credit_loss": number,
      "concessions": number,
      "laundry_income": number,
      "parking_income": number,
      "pet_fees": number,
      "application_fees": number,
      "late_fees": number,
      "utility_reimbursements": number,
      "storage_income": number,
      "other_income": number,
      "property_taxes": number,
      "insurance": number,
      "utilities": number,
      "utilities_water": number,
      "utilities_electric": number,
      "utilities_gas": number,
      "repairs_maintenance": number,
      "turnover_costs": number,
      "landscaping": number,
      "payroll": number,
      "management_fees": number,
      "admin_expenses": number,
      "marketing": number,
      "contract_services": number,
      "trash_removal": number,
      "pest_control": number,
      "other_expenses": number
    }
  ],
  "total_gpi": number (annual),
  "total_egi": number (annual),
  "total_opex": number (annual),
  "total_noi": number (annual),
  "source": "seller_provided"
}

If only annual totals are given (no monthly breakdown), put all values in a single month entry using the period_end month. Return ONLY the JSON object.`;

export async function normalizeT12(
  buffer: ArrayBuffer,
  fileName: string
): Promise<T12Statement> {
  const { text, isPdf } = await fileToText(buffer, fileName);
  const client = getClient();

  const content: Anthropic.Messages.ContentBlockParam[] = isPdf
    ? [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: text } },
        { type: "text", text: T12_PROMPT },
      ]
    : [{ type: "text", text: `${T12_PROMPT}\n\nData:\n${text}` }];

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16000,
    system: T12_SYSTEM,
    messages: [{ role: "user", content }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No response from AI");

  let json = block.text.trim();
  const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();

  const parsed = JSON.parse(json) as T12Statement;
  if (!parsed.months) parsed.months = [];

  return parsed;
}
