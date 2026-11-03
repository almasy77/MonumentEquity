/**
 * RentCast API client (server-only). Wraps the long-term rent AVM endpoint, which
 * returns a rent estimate plus rental comparables. The API key is read from the
 * RENTCAST_API_KEY environment variable and is NEVER sent to the client — callers go
 * through the server routes under /api/deals/[id]/rentcast.
 *
 * Docs: https://developers.rentcast.io/reference/rent-estimate-long-term
 * NOTE: for Multi-Family / Apartment property types RentCast returns a PER-UNIT rent
 * estimate (one unit of the given bedroom count), not the whole building.
 */

const BASE_URL = "https://api.rentcast.io/v1";

export type RentCastPropertyType =
  | "Single Family"
  | "Condo"
  | "Townhouse"
  | "Manufactured"
  | "Multi-Family"
  | "Apartment";

export interface RentCastComp {
  id?: string;
  formattedAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  price?: number; // the comp's listed rent ($/mo)
  listingType?: string;
  status?: string;
  listedDate?: string;
  lastSeenDate?: string;
  daysOnMarket?: number;
  distance?: number; // miles from the subject
  correlation?: number; // similarity score 0..1, higher = more similar
}

export interface RentCastRentEstimate {
  rent: number;
  rentRangeLow: number;
  rentRangeHigh: number;
  comparables: RentCastComp[];
}

export interface RentEstimateParams {
  address: string; // "Street, City, State, Zip"
  propertyType?: RentCastPropertyType;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  compCount?: number; // 5..25
  maxRadius?: number; // miles
}

/** True when the RentCast API key is configured on the server. */
export function rentcastConfigured(): boolean {
  return !!process.env.RENTCAST_API_KEY;
}

/** Map a deal's free-text property type to the closest RentCast enum. */
export function toRentCastPropertyType(raw: string | undefined): RentCastPropertyType | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("apart")) return "Apartment";
  if (s.includes("multi")) return "Multi-Family";
  if (s.includes("condo")) return "Condo";
  if (s.includes("town")) return "Townhouse";
  if (s.includes("manufact") || s.includes("mobile")) return "Manufactured";
  if (s.includes("single") || s.includes("sfr") || s.includes("duplex")) return "Single Family";
  return undefined;
}

export class RentCastError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RentCastError";
  }
}

// ── Property records (GET /properties) ──
export interface RentCastTaxAssessment { year?: number; value?: number; land?: number; improvements?: number }
export interface RentCastProperty {
  id?: string;
  formattedAddress?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number; // square feet
  yearBuilt?: number;
  county?: string;
  lastSaleDate?: string;
  lastSalePrice?: number;
  features?: { unitCount?: number; [k: string]: unknown };
  taxAssessments?: Record<string, RentCastTaxAssessment>;
}

/** Candidate deal fields derived from a RentCast property record (undefined = not found). */
export interface RentCastDealFields {
  units?: number;
  year_built?: number;
  square_footage?: number;
  lot_size?: string;
  property_type?: string;
  assessed_value?: number;
  owner_acquisition_price?: number;
  owner_since?: string;
  county?: string;
}

/** Fetch the property record for an address (first match). */
export async function fetchPropertyRecord(address: string): Promise<RentCastProperty | null> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new RentCastError("RENTCAST_API_KEY is not configured on the server.", 500);
  const q = new URLSearchParams({ address, limit: "1" });
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/properties?${q.toString()}`, { headers: { "X-Api-Key": key, Accept: "application/json" } });
  } catch (e) {
    throw new RentCastError(`RentCast request failed: ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RentCastError(res.status === 401 ? "RentCast rejected the API key (401)." : `RentCast error ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  const data = (await res.json()) as RentCastProperty[] | RentCastProperty;
  const rec = Array.isArray(data) ? data[0] : data;
  return rec ?? null;
}

/** Map a RentCast property record to the deal fields we can pre-fill. */
export function mapPropertyToDealFields(rec: RentCastProperty): RentCastDealFields {
  // Latest tax assessment (highest year).
  let latestAssessed: number | undefined;
  if (rec.taxAssessments) {
    const years = Object.keys(rec.taxAssessments).map(Number).filter((n) => !Number.isNaN(n));
    if (years.length) latestAssessed = rec.taxAssessments[String(Math.max(...years))]?.value;
  }
  return {
    units: rec.features?.unitCount,
    year_built: rec.yearBuilt,
    square_footage: rec.squareFootage,
    lot_size: rec.lotSize ? `${rec.lotSize.toLocaleString()} SF` : undefined,
    property_type: rec.propertyType,
    assessed_value: latestAssessed,
    owner_acquisition_price: rec.lastSalePrice,
    owner_since: rec.lastSaleDate,
    county: rec.county,
  };
}

/**
 * Fetch a long-term rent estimate + rental comps. Throws RentCastError on a non-2xx
 * response (401 = bad/missing key) or when the key is not configured.
 */
export async function fetchRentEstimate(params: RentEstimateParams): Promise<RentCastRentEstimate> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new RentCastError("RENTCAST_API_KEY is not configured on the server.", 500);

  const q = new URLSearchParams({ address: params.address });
  if (params.propertyType) q.set("propertyType", params.propertyType);
  if (params.bedrooms != null) q.set("bedrooms", String(params.bedrooms));
  if (params.bathrooms != null) q.set("bathrooms", String(params.bathrooms));
  if (params.squareFootage != null) q.set("squareFootage", String(params.squareFootage));
  if (params.compCount != null) q.set("compCount", String(Math.max(5, Math.min(25, params.compCount))));
  if (params.maxRadius != null) q.set("maxRadius", String(params.maxRadius));

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/avm/rent/long-term?${q.toString()}`, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
    });
  } catch (e) {
    throw new RentCastError(`RentCast request failed: ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RentCastError(
      res.status === 401 ? "RentCast rejected the API key (401)." : `RentCast error ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    );
  }
  const data = (await res.json()) as Partial<RentCastRentEstimate>;
  return {
    rent: data.rent ?? 0,
    rentRangeLow: data.rentRangeLow ?? 0,
    rentRangeHigh: data.rentRangeHigh ?? 0,
    comparables: Array.isArray(data.comparables) ? data.comparables : [],
  };
}
