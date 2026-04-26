import Anthropic from "@anthropic-ai/sdk";

export interface OMExtractedData {
  property: {
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    units?: number;
    year_built?: number;
    property_type?: string;
    square_footage?: number;
    lot_size?: string;
    stories?: number;
    parking_spaces?: number;
    parking_type?: string;
    construction_type?: string;
    hvac_type?: string;
    laundry_type?: string;
    amenities?: string[];
  };
  financials: {
    asking_price?: number;
    current_noi?: number;
    pro_forma_noi?: number;
    current_occupancy?: number;
    in_place_cap_rate?: number;
    pro_forma_cap_rate?: number;
    current_annual_taxes?: number;
    current_annual_insurance?: number;
    grm?: number;
  };
  rent_roll: {
    unit_number: string;
    unit_type?: string;
    sqft?: number;
    status?: "occupied" | "vacant" | "notice_to_vacate" | "down";
    current_rent?: number;
    market_rent?: number;
    lease_start?: string;
    lease_end?: string;
    other_charges?: number;
  }[];
  t12: {
    months: {
      month: string;
      gross_potential_rent?: number;
      vacancy_loss?: number;
      laundry_income?: number;
      parking_income?: number;
      pet_fees?: number;
      utility_reimbursements?: number;
      other_income?: number;
      property_taxes?: number;
      insurance?: number;
      utilities?: number;
      repairs_maintenance?: number;
      payroll?: number;
      management_fees?: number;
      admin_expenses?: number;
      marketing?: number;
      contract_services?: number;
      trash_removal?: number;
      landscaping?: number;
      pest_control?: number;
      turnover_costs?: number;
      other_expenses?: number;
    }[];
    total_gpi?: number;
    total_egi?: number;
    total_opex?: number;
    total_noi?: number;
  };
  market_notes?: string;
}

const SYSTEM_PROMPT = `You are a commercial real estate underwriting assistant. Extract structured data from offering memorandums (OMs) for multifamily and commercial properties.

Return ONLY valid JSON matching the schema below. Be precise with numbers — no rounding. For percentages like occupancy and cap rates, convert to decimals (95% → 0.95, 6.5% → 0.065). For dollar amounts, use raw numbers without formatting.

If a field is not found in the document, omit it entirely (do not include null values).

For the rent roll: extract every unit listed. Use the unit number/label exactly as shown. If market rent is listed separately from current/in-place rent, include both. Status should be "occupied", "vacant", "notice_to_vacate", or "down".

For the T12: extract monthly data if available. Use YYYY-MM format for month fields (e.g. "2025-01"). If only annual totals are given, create a single entry with the annual amounts. Expense items should be positive numbers (not negative).

For lease dates: use YYYY-MM-DD format when possible, or YYYY-MM if only month/year is given.`;

const EXTRACTION_PROMPT = `Extract all property details, financials, rent roll, and T12 operating statement from this offering memorandum.

Return JSON matching this structure:
{
  "property": {
    "address": "string",
    "city": "string",
    "state": "2-letter abbreviation",
    "zip": "string",
    "county": "string",
    "units": number,
    "year_built": number,
    "property_type": "string",
    "square_footage": number,
    "lot_size": "string",
    "stories": number,
    "parking_spaces": number,
    "parking_type": "surface|garage|street",
    "construction_type": "string",
    "hvac_type": "string",
    "laundry_type": "in_unit|common_area|none",
    "amenities": ["string"]
  },
  "financials": {
    "asking_price": number,
    "current_noi": number,
    "pro_forma_noi": number,
    "current_occupancy": decimal (0-1),
    "in_place_cap_rate": decimal (0-1),
    "pro_forma_cap_rate": decimal (0-1),
    "current_annual_taxes": number,
    "current_annual_insurance": number,
    "grm": number
  },
  "rent_roll": [
    {
      "unit_number": "string",
      "unit_type": "Studio|1BR/1BA|2BR/1BA|etc",
      "sqft": number,
      "status": "occupied|vacant|notice_to_vacate|down",
      "current_rent": number (monthly),
      "market_rent": number (monthly),
      "lease_start": "YYYY-MM-DD",
      "lease_end": "YYYY-MM-DD",
      "other_charges": number (monthly)
    }
  ],
  "t12": {
    "months": [
      {
        "month": "YYYY-MM",
        "gross_potential_rent": number,
        "vacancy_loss": number,
        ...expense line items...
      }
    ],
    "total_gpi": number (annual),
    "total_egi": number (annual),
    "total_opex": number (annual),
    "total_noi": number (annual)
  },
  "market_notes": "Brief summary of key selling points, market context, or value-add opportunity mentioned in the OM"
}

Extract everything you can find. Return ONLY the JSON object, no markdown formatting.`;

export async function extractFromOM(
  fileBase64: string,
  mediaType: "application/pdf" | "image/png" | "image/jpeg" = "application/pdf"
): Promise<OMExtractedData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured. Add it to your .env.local file.");
  }

  const client = new Anthropic({ apiKey });

  const fileBlock: Anthropic.Messages.ContentBlockParam = mediaType === "application/pdf"
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: fileBase64 },
      };

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let jsonStr = textBlock.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr) as OMExtractedData;

  if (!parsed.property) parsed.property = {};
  if (!parsed.financials) parsed.financials = {};
  if (!parsed.rent_roll) parsed.rent_roll = [];
  if (!parsed.t12) parsed.t12 = { months: [] };

  return parsed;
}
