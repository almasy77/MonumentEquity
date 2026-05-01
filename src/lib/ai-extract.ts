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
  photo_url?: string;
}

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

const STATE_ABBREVS = new Set(Object.values(US_STATES));

export async function extractImageFromUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const ogImage = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
    if (!ogImage) return null;
    return ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
  } catch {
    return null;
  }
}

export async function extractDealFromUrl(
  url: string
): Promise<ExtractedDeal> {
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
  const text = htmlToText(html);

  // Try JSON-LD and regex first for fast structured data
  const regexResult = extractFromHtml(html, url);
  const hasGoodData = regexResult.address && regexResult.units && regexResult.asking_price;

  if (hasGoodData) {
    return regexResult;
  }

  // Fall back to Claude AI extraction for messy / SPA pages
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return regexResult;
  }

  try {
    const pageContent = text.slice(0, 15000);
    const client = new Anthropic({ apiKey });
    const aiResponse = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      system: `You are a commercial real estate data extraction assistant. Extract listing details from webpage text. Return ONLY valid JSON with no markdown fences. For state, use 2-letter abbreviations. For prices, use raw numbers. Omit any field you cannot find.`,
      messages: [{
        role: "user",
        content: `Extract real estate listing data from this webpage (URL: ${url}).

Return JSON:
{
  "address": "street address",
  "city": "city name",
  "state": "XX (2-letter)",
  "zip": "XXXXX",
  "units": number,
  "asking_price": number,
  "year_built": number,
  "property_type": "Multifamily|Garden-Style|Mid-Rise|High-Rise|Townhome|Duplex|Triplex|Quadplex|Mixed-Use|Office|Retail|Industrial",
  "square_footage": number,
  "market_notes": "Brief summary of key details, value-add opportunity, highlights"
}

Page content:
${pageContent}`,
      }],
    });

    const block = aiResponse.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return regexResult;

    let json = block.text.trim();
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();

    const aiResult = JSON.parse(json) as ExtractedDeal;
    const merged: ExtractedDeal = {};
    const addr = aiResult.address || regexResult.address;
    const city = aiResult.city || regexResult.city;
    const state = aiResult.state || regexResult.state;
    const zip = aiResult.zip || regexResult.zip;
    const units = aiResult.units || regexResult.units;
    const price = aiResult.asking_price || regexResult.asking_price;
    const year = aiResult.year_built || regexResult.year_built;
    const ptype = aiResult.property_type || regexResult.property_type;
    const sf = aiResult.square_footage || regexResult.square_footage;
    const notes = aiResult.market_notes || regexResult.market_notes;
    if (addr) merged.address = addr;
    if (city) merged.city = city;
    if (state) merged.state = state;
    if (zip) merged.zip = zip;
    if (units) merged.units = units;
    if (price) merged.asking_price = price;
    if (year) merged.year_built = year;
    if (ptype) merged.property_type = ptype;
    if (sf) merged.square_footage = sf;
    if (notes) merged.market_notes = notes;
    return merged;
  } catch (err) {
    console.error("AI URL extraction failed, using regex fallback:", err);
    return regexResult;
  }
}

export async function extractDealFromText(
  text: string
): Promise<ExtractedDeal> {
  return extractFromPlainText(text);
}

function extractFromHtml(html: string, url: string): ExtractedDeal {
  const result: ExtractedDeal = {};
  const text = htmlToText(html);

  // Try JSON-LD structured data first (many listing sites use schema.org)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    if (jsonLd.address) result.address = jsonLd.address;
    if (jsonLd.city) result.city = jsonLd.city;
    if (jsonLd.state) result.state = jsonLd.state;
    if (jsonLd.zip) result.zip = jsonLd.zip;
  }

  // Try Open Graph / meta tags
  const ogTitle = extractMeta(html, "og:title") || extractMeta(html, "title");
  const ogDesc = extractMeta(html, "og:description") || extractMeta(html, "description");
  const ogImage = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
  if (ogImage) {
    try {
      const imgUrl = ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
      result.photo_url = imgUrl;
    } catch {
      // Invalid image URL, skip
    }
  }

  // Extract from text patterns
  const textResult = extractFromPlainText(text);

  // Merge: JSON-LD > text patterns > OG meta
  if (!result.address && textResult.address) result.address = textResult.address;
  if (!result.city && textResult.city) result.city = textResult.city;
  if (!result.state && textResult.state) result.state = textResult.state;
  if (!result.zip && textResult.zip) result.zip = textResult.zip;
  if (textResult.units) result.units = textResult.units;
  if (textResult.asking_price) result.asking_price = textResult.asking_price;
  if (textResult.year_built) result.year_built = textResult.year_built;
  if (textResult.property_type) result.property_type = textResult.property_type;
  if (textResult.square_footage) result.square_footage = textResult.square_footage;

  // Build market notes from OG description or page title
  const notes: string[] = [];
  if (ogTitle) notes.push(ogTitle);
  if (ogDesc && ogDesc !== ogTitle) notes.push(ogDesc);
  if (notes.length > 0) {
    result.market_notes = notes.join(" — ").slice(0, 500);
  } else if (textResult.market_notes) {
    result.market_notes = textResult.market_notes;
  }

  // Detect property type from URL if not found
  if (!result.property_type) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes("multifamily") || urlLower.includes("apartment")) {
      result.property_type = "Multifamily";
    }
  }

  return result;
}

function extractFromPlainText(text: string): ExtractedDeal {
  const result: ExtractedDeal = {};

  // Address: look for street number + street name pattern
  // e.g. "123 Main Street" or "4500 Durham-Chapel Hill Blvd"
  const addressMatch = text.match(
    /(\d{1,6}\s+(?:[NSEW]\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Za-z]+){0,4}\s+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Cir(?:cle)?|Pkwy|Parkway|Hwy|Highway)\.?)/i
  );
  if (addressMatch) {
    result.address = addressMatch[1].trim();
  }

  // City, State ZIP pattern: "Durham, NC 27707" or "Durham, North Carolina 27707"
  const cityStateZipMatch = text.match(
    /([A-Z][a-zA-Z\s]{1,30}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/
  );
  if (cityStateZipMatch) {
    result.city = cityStateZipMatch[1].trim();
    const st = cityStateZipMatch[2].toUpperCase();
    if (STATE_ABBREVS.has(st)) result.state = st;
    result.zip = cityStateZipMatch[3];
  } else {
    // Try full state name: "Durham, North Carolina"
    const fullStateMatch = text.match(
      /([A-Z][a-zA-Z\s]{1,30}),\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)/i
    );
    if (fullStateMatch) {
      result.city = fullStateMatch[1].trim();
      result.state = US_STATES[fullStateMatch[2].toLowerCase()] || undefined;
    }

    // ZIP separately
    const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (zipMatch && !result.zip) result.zip = zipMatch[1];
  }

  // Price patterns: "$2,500,000" or "$2.5M" or "Price: $2,500,000" or "Asking: $1.8M"
  const pricePatterns = [
    /(?:price|asking|listed?\s+(?:at|for)|offering)\s*:?\s*\$\s*([\d,]+(?:\.\d+)?)\s*(m(?:illion)?|k)?/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*(m(?:illion)?|k)?/i,
  ];
  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match) {
      let price = parseFloat(match[1].replace(/,/g, ""));
      const suffix = (match[2] || "").toLowerCase();
      if (suffix.startsWith("m")) price *= 1_000_000;
      else if (suffix === "k") price *= 1_000;
      if (price >= 50_000 && price <= 500_000_000) {
        result.asking_price = Math.round(price);
        break;
      }
    }
  }

  // Units: "12 units" or "12-unit" or "Units: 12"
  const unitPatterns = [
    /(\d{1,4})\s*[-–]?\s*units?\b/i,
    /units?\s*:?\s*(\d{1,4})\b/i,
    /(\d{1,4})\s*(?:apartments?|residences?|doors?)\b/i,
  ];
  for (const pattern of unitPatterns) {
    const match = text.match(pattern);
    if (match) {
      const units = parseInt(match[1], 10);
      if (units >= 2 && units <= 1000) {
        result.units = units;
        break;
      }
    }
  }

  // Year built: "Built in 1972" or "Year Built: 1972" or "Vintage: 1985"
  const yearPatterns = [
    /(?:year\s+)?built\s*(?:in)?\s*:?\s*(\d{4})/i,
    /vintage\s*:?\s*(\d{4})/i,
    /constructed\s*(?:in)?\s*:?\s*(\d{4})/i,
  ];
  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 1850 && year <= 2030) {
        result.year_built = year;
        break;
      }
    }
  }

  // Square footage: "50,000 SF" or "Square Feet: 50000" or "50,000 sq ft"
  const sfPatterns = [
    /([\d,]+)\s*(?:sf|sq\.?\s*(?:ft|feet|footage))\b/i,
    /(?:square\s*(?:feet|footage)|total\s+sf|building\s+size)\s*:?\s*([\d,]+)/i,
  ];
  for (const pattern of sfPatterns) {
    const match = text.match(pattern);
    if (match) {
      const sf = parseInt(match[1].replace(/,/g, ""), 10);
      if (sf >= 500 && sf <= 10_000_000) {
        result.square_footage = sf;
        break;
      }
    }
  }

  // Property type detection
  const textLower = text.toLowerCase();
  const typeKeywords: [RegExp, string][] = [
    [/\b(?:multi-?family|apartment)\b/i, "Multifamily"],
    [/\bgarden[\s-]?style\b/i, "Garden-Style"],
    [/\bmid[\s-]?rise\b/i, "Mid-Rise"],
    [/\bhigh[\s-]?rise\b/i, "High-Rise"],
    [/\btownhome|townhouse\b/i, "Townhome"],
    [/\bduplex\b/i, "Duplex"],
    [/\btriplex\b/i, "Triplex"],
    [/\bquadplex|fourplex\b/i, "Quadplex"],
  ];
  for (const [pattern, type] of typeKeywords) {
    if (pattern.test(textLower)) {
      result.property_type = type;
      break;
    }
  }

  return result;
}

function extractJsonLd(html: string): { address?: string; city?: string; state?: string; zip?: string } | null {
  const jsonLdMatches = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const addr = item.address || item.location?.address;
        if (addr) {
          return {
            address: addr.streetAddress || undefined,
            city: addr.addressLocality || undefined,
            state: addr.addressRegion || undefined,
            zip: addr.postalCode || undefined,
          };
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }
  return null;
}

function extractMeta(html: string, name: string): string | null {
  // Try property attribute (Open Graph)
  const propMatch = html.match(
    new RegExp(`<meta[^>]*property\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i")
  );
  if (propMatch) return decodeHtmlEntities(propMatch[1]);

  // Try name attribute
  const nameMatch = html.match(
    new RegExp(`<meta[^>]*name\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i")
  );
  if (nameMatch) return decodeHtmlEntities(nameMatch[1]);

  // Try reverse attribute order
  const revMatch = html.match(
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`, "i")
  );
  if (revMatch) return decodeHtmlEntities(revMatch[1]);

  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
