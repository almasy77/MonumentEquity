import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedContact {
  name?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  type?: "broker" | "seller" | "property_manager" | "other";
}

export interface OMExtractedData {
  document_type: "offering_memo" | "rent_roll" | "t12" | "other";
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
    roof_type?: string;
    hvac_type?: string;
    laundry_type?: string;
    water_heater?: string;
    electrical?: string;
    plumbing?: string;
    foundation?: string;
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
    assessed_value?: number;
    tax_rate?: number;
    grm?: number;
  };
  contacts: ExtractedContact[];
  rent_roll: {
    unit_number: string;
    unit_type?: string;
    sqft?: number;
    status?: "occupied" | "vacant" | "notice_to_vacate" | "down";
    tenant_name?: string;
    current_rent?: number;
    market_rent?: number;
    other_charges?: number;
    lease_start?: string;
    lease_end?: string;
    move_in_date?: string;
    security_deposit?: number;
    concessions?: number;
    notes?: string;
  }[];
  t12: {
    period_start?: string;
    period_end?: string;
    months: {
      month: string;
      gross_potential_rent?: number;
      vacancy_loss?: number;
      credit_loss?: number;
      concessions?: number;
      laundry_income?: number;
      parking_income?: number;
      pet_fees?: number;
      application_fees?: number;
      late_fees?: number;
      utility_reimbursements?: number;
      storage_income?: number;
      other_income?: number;
      property_taxes?: number;
      insurance?: number;
      utilities?: number;
      utilities_water?: number;
      utilities_electric?: number;
      utilities_gas?: number;
      repairs_maintenance?: number;
      turnover_costs?: number;
      landscaping?: number;
      payroll?: number;
      management_fees?: number;
      admin_expenses?: number;
      marketing?: number;
      contract_services?: number;
      trash_removal?: number;
      pest_control?: number;
      other_expenses?: number;
    }[];
    total_gpi?: number;
    total_egi?: number;
    total_opex?: number;
    total_noi?: number;
    source?: string;
  };
  market_notes?: string;
}

const SYSTEM_PROMPT = `You are a commercial real estate underwriting assistant. Extract structured data from real estate documents — offering memorandums (OMs), rent rolls, T12 operating statements, or any combination.

First, identify the document type:
- "offering_memo" — a full OM with property details, financials, photos, market info
- "rent_roll" — a standalone rent roll / unit mix showing unit-level data
- "t12" — a standalone trailing 12-month operating statement
- "other" — any other document with partial real estate data

Return ONLY valid JSON. Be precise with numbers — no rounding. For percentages like occupancy and cap rates, convert to decimals (95% → 0.95, 6.5% → 0.065). For dollar amounts, use raw numbers without formatting.

If a field is not found in the document, omit it entirely (do not include null values).

For the rent roll: extract EVERY unit listed. Use the unit number/label exactly as shown. Include tenant names if shown. If market rent is listed separately from current/in-place rent, include both. Status should be "occupied", "vacant", "notice_to_vacate", or "down".

For the T12: extract monthly data if available. Use YYYY-MM format for month fields (e.g. "2025-01"). If only annual totals are given, create a single entry with the annual amounts. Break out utility sub-categories (water, electric, gas) when available. Expense items should be positive numbers (not negative).

For contacts: extract ALL broker contacts, seller contacts, and property management contacts. Include every name, company, title, email, and phone number you can find — check the cover page, headers, footers, confidentiality notices, and contact sections.

For lease dates: use YYYY-MM-DD format when possible, or YYYY-MM if only month/year is given.`;

const EXTRACTION_PROMPT = `Extract ALL available data from this real estate document. Pull out every detail you can find.

Return JSON matching this structure:
{
  "document_type": "offering_memo|rent_roll|t12|other",
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
    "roof_type": "string",
    "hvac_type": "string",
    "laundry_type": "in_unit|common_area|none",
    "water_heater": "individual|central_boiler",
    "electrical": "individual_meters|master_metered",
    "plumbing": "copper|pex|galvanized|mixed",
    "foundation": "slab|crawl_space|basement",
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
    "assessed_value": number,
    "tax_rate": decimal,
    "grm": number
  },
  "contacts": [
    {
      "name": "Full Name",
      "company": "Company Name",
      "title": "Title / Role",
      "email": "email@example.com",
      "phone": "555-123-4567",
      "type": "broker|seller|property_manager|other"
    }
  ],
  "rent_roll": [
    {
      "unit_number": "string",
      "unit_type": "Studio|1BR/1BA|2BR/1BA|etc",
      "sqft": number,
      "status": "occupied|vacant|notice_to_vacate|down",
      "tenant_name": "string",
      "current_rent": number (monthly),
      "market_rent": number (monthly),
      "other_charges": number (monthly — parking, pet, storage, utilities),
      "lease_start": "YYYY-MM-DD",
      "lease_end": "YYYY-MM-DD",
      "move_in_date": "YYYY-MM-DD",
      "security_deposit": number,
      "concessions": number (monthly),
      "notes": "string"
    }
  ],
  "t12": {
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
    "source": "seller_provided|broker_om|verified|estimated"
  },
  "market_notes": "Brief summary of key selling points, market context, value-add opportunity, or any other notable information from the document"
}

Extract EVERYTHING you can find — every contact, every unit, every line item. Return ONLY the JSON object, no markdown formatting.`;

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

  let response;
  try {
    response = await client.messages.create({
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
  } catch (err: unknown) {
    const apiErr = err as { status?: number; message?: string; error?: { message?: string } };
    const detail = apiErr.error?.message || apiErr.message || "Unknown error";
    if (apiErr.status === 401) {
      throw new Error("Invalid API key. Check ANTHROPIC_API_KEY in your environment variables.");
    }
    if (apiErr.status === 429) {
      throw new Error("API rate limit exceeded. Please try again in a moment.");
    }
    if (apiErr.status === 400) {
      throw new Error(`API request error: ${detail}. The file may be too large or in an unsupported format.`);
    }
    throw new Error(`Claude API error (${apiErr.status || "network"}): ${detail}`);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let jsonStr = textBlock.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: OMExtractedData;
  try {
    parsed = JSON.parse(jsonStr) as OMExtractedData;
  } catch {
    throw new Error(`Failed to parse AI response. Raw output: ${jsonStr.slice(0, 200)}...`);
  }

  if (!parsed.document_type) parsed.document_type = "other";
  if (!parsed.property) parsed.property = {};
  if (!parsed.financials) parsed.financials = {};
  if (!parsed.contacts) parsed.contacts = [];
  if (!parsed.rent_roll) parsed.rent_roll = [];
  if (!parsed.t12) parsed.t12 = { months: [] };

  return parsed;
}
