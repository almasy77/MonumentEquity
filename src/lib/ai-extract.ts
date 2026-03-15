import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedDeal {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  units?: number;
  asking_price?: number;
  year_built?: number;
  property_type?: string;
  square_footage?: number;
  market_notes?: string;
}

const EXTRACTION_PROMPT = `You are a real estate data extraction assistant. Extract property details from the following listing page content.

Return ONLY a JSON object with these fields (omit any field you cannot confidently determine):
- address (street address only, no city/state/zip)
- city
- state (2-letter abbreviation)
- zip (5-digit)
- units (integer, number of residential units)
- asking_price (number, no formatting — e.g. 2500000 not "$2.5M")
- year_built (integer, 4-digit year)
- property_type (e.g. "Multifamily", "Garden-Style", "Mid-Rise", etc.)
- square_footage (integer, total building SF)
- market_notes (brief summary of key listing highlights — max 200 words)

IMPORTANT: Return raw JSON only. No markdown, no code fences, no explanation.`;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

export async function extractDealFromUrl(
  url: string
): Promise<ExtractedDeal> {
  // Fetch the listing page HTML
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Strip HTML to text (simple approach — remove tags, scripts, styles)
  const textContent = htmlToText(html);

  // Truncate to avoid token limits (keep first ~8000 chars which usually has listing details)
  const truncated = textContent.slice(0, 8000);

  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\n---\n\nLISTING PAGE CONTENT:\n${truncated}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response from Claude API");
  }

  try {
    const parsed = JSON.parse(content.text);
    return validateExtracted(parsed);
  } catch {
    throw new Error("Failed to parse extracted data from Claude API");
  }
}

export async function extractDealFromText(
  text: string
): Promise<ExtractedDeal> {
  const truncated = text.slice(0, 8000);

  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\n---\n\nLISTING/EMAIL CONTENT:\n${truncated}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response from Claude API");
  }

  try {
    const parsed = JSON.parse(content.text);
    return validateExtracted(parsed);
  } catch {
    throw new Error("Failed to parse extracted data from Claude API");
  }
}

function validateExtracted(data: Record<string, unknown>): ExtractedDeal {
  const result: ExtractedDeal = {};

  if (typeof data.address === "string" && data.address.length > 0)
    result.address = data.address;
  if (typeof data.city === "string" && data.city.length > 0)
    result.city = data.city;
  if (typeof data.state === "string" && data.state.length > 0)
    result.state = data.state;
  if (typeof data.zip === "string" && data.zip.length > 0)
    result.zip = data.zip;
  if (typeof data.units === "number" && data.units > 0)
    result.units = Math.floor(data.units);
  if (typeof data.asking_price === "number" && data.asking_price > 0)
    result.asking_price = data.asking_price;
  if (typeof data.year_built === "number" && data.year_built > 1800)
    result.year_built = Math.floor(data.year_built);
  if (typeof data.property_type === "string" && data.property_type.length > 0)
    result.property_type = data.property_type;
  if (typeof data.square_footage === "number" && data.square_footage > 0)
    result.square_footage = Math.floor(data.square_footage);
  if (typeof data.market_notes === "string" && data.market_notes.length > 0)
    result.market_notes = data.market_notes;

  return result;
}

function htmlToText(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Replace block-level tags with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
