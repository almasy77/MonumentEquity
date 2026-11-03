/**
 * ATTOM Data API client (server-only). Wraps the property "detail with mortgage"
 * package, which returns the deed / mortgage record on file for a property: the
 * ORIGINAL recorded loan(s), lender, origination date, rate and term. ATTOM does NOT
 * publish a live payoff balance, so we amortize the original loan forward to today to
 * produce an ESTIMATED outstanding balance (clearly labeled an estimate everywhere).
 *
 * The API key is read from ATTOM_API_KEY and is NEVER sent to the client — callers go
 * through the server route under /api/deals/[id]/attom-mortgage.
 *
 * Docs: https://api.developer.attomdata.com/docs  (property / detailmortgage)
 * Auth: `apikey` request header + `Accept: application/json`.
 *
 * NOTE ON SCHEMA: ATTOM's mortgage object nesting varies by record (FirstConcurrent /
 * SecondConcurrent sub-objects, or a flat object; sometimes under `sale.mortgage`). The
 * parser here is deliberately tolerant and reads whichever shape comes back. Field names
 * are based on ATTOM's documented schema; verify against a live response once the key is
 * provisioned (this module was built without live API access).
 */

const BASE_URL = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

/** True when the ATTOM API key is configured on the server. */
export function attomConfigured(): boolean {
  return !!process.env.ATTOM_API_KEY;
}

export class AttomError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AttomError";
  }
}

/** One recorded loan parsed out of an ATTOM mortgage record. */
export interface AttomLoan {
  position: "first" | "second" | "other";
  originalAmount?: number; // recorded loan amount ($)
  interestRate?: number; // annual, decimal (0.065) — normalized from ATTOM's percent
  originationDate?: string; // ISO date the deed was recorded
  termMonths?: number; // loan term, normalized to months
  lender?: string;
  loanType?: string; // e.g. "CNV" / "FHA" / "VA" / deed type
  /** Estimated current balance from straight amortization, or undefined if not computable. */
  estimatedBalance?: number;
  /** Months elapsed since origination used for the estimate (for transparency). */
  monthsElapsed?: number;
  /** Why an estimate could not be produced (missing rate/term/date/amount). */
  estimateNote?: string;
}

export interface AttomMortgageResult {
  address: string;
  loans: AttomLoan[];
  /** Sum of estimated balances across loans with a computable estimate. */
  totalEstimatedBalance?: number;
  fetchedAt: string;
}

// ── numeric / field helpers ──────────────────────────────────────────────

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,$]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Pick the first defined value among several candidate keys (case-insensitive). */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) lower[k.toLowerCase()] = v;
  for (const k of keys) {
    const hit = lower[k.toLowerCase()];
    if (hit != null && hit !== "") return hit;
  }
  return undefined;
}

/** ATTOM gives rate as a percent (6.5) or occasionally a decimal (0.065). Normalize to decimal. */
function normalizeRate(raw: unknown): number | undefined {
  const r = num(raw);
  if (r == null) return undefined;
  const dec = r > 1 ? r / 100 : r;
  // Sanity clamp: anything above 25% annual is almost certainly bad data.
  return dec > 0 && dec < 0.25 ? dec : undefined;
}

/** ATTOM gives term in months (360) or years (30). Normalize to months. */
function normalizeTermMonths(raw: unknown): number | undefined {
  const t = num(raw);
  if (t == null) return undefined;
  return t <= 50 ? Math.round(t * 12) : Math.round(t);
}

function isoDate(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function monthsBetween(fromIso: string, toDate: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const months = (toDate.getFullYear() - from.getFullYear()) * 12 + (toDate.getMonth() - from.getMonth());
  return Math.max(0, months);
}

/**
 * Remaining balance of a fully-amortizing fixed loan after `k` payments.
 *   P·[(1+i)^n − (1+i)^k] / [(1+i)^n − 1]   (i>0)
 *   P·(1 − k/n)                              (i≈0)
 */
function amortizedBalance(principal: number, annualRate: number, termMonths: number, monthsElapsed: number): number {
  const n = termMonths;
  const k = Math.min(monthsElapsed, n);
  if (k >= n) return 0;
  const i = annualRate / 12;
  if (i <= 1e-9) return principal * (1 - k / n);
  const powN = Math.pow(1 + i, n);
  const powK = Math.pow(1 + i, k);
  return principal * ((powN - powK) / (powN - 1));
}

// ── parsing ───────────────────────────────────────────────────────────────

/** Parse a single loan sub-object into our shape + an amortized estimate. */
function parseLoan(raw: Record<string, unknown>, position: AttomLoan["position"], asOf: Date): AttomLoan | null {
  const originalAmount = num(pick(raw, ["amount", "loanAmount", "amt"]));
  const interestRate = normalizeRate(pick(raw, ["interestRate", "rate", "intRate"]));
  const originationDate = isoDate(pick(raw, ["date", "recordingDate", "mortgageDate", "dateRecorded"]));
  const termMonths = normalizeTermMonths(pick(raw, ["term", "loanTerm", "loanTermMonths"]));
  const lenderRaw = pick(raw, ["lender", "lenderLastName", "companyName", "lenderName"]);
  const loanType = pick(raw, ["loanType", "loanTypeCode", "deedType", "trustDeedType"]);

  // Not a real loan sub-object if there's no amount and no date.
  if (originalAmount == null && !originationDate) return null;

  const loan: AttomLoan = {
    position,
    originalAmount,
    interestRate,
    originationDate,
    termMonths,
    lender: lenderRaw != null ? String(lenderRaw) : undefined,
    loanType: loanType != null ? String(loanType) : undefined,
  };

  // Estimate only when we have all amortization inputs.
  if (originalAmount && interestRate && termMonths && originationDate) {
    const monthsElapsed = monthsBetween(originationDate, asOf);
    loan.monthsElapsed = monthsElapsed;
    loan.estimatedBalance = Math.round(amortizedBalance(originalAmount, interestRate, termMonths, monthsElapsed));
  } else {
    const missing: string[] = [];
    if (!originalAmount) missing.push("loan amount");
    if (!interestRate) missing.push("interest rate");
    if (!termMonths) missing.push("term");
    if (!originationDate) missing.push("origination date");
    loan.estimateNote = `No payoff estimate — record is missing ${missing.join(", ")}.`;
  }
  return loan;
}

/** Find the mortgage container inside a property record, wherever ATTOM put it. */
function findMortgageObject(prop: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = prop.mortgage ?? (prop.sale as Record<string, unknown> | undefined)?.mortgage;
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;
  return undefined;
}

/** Extract all loans from a property record's mortgage object (tolerant of nesting). */
export function extractLoans(prop: Record<string, unknown>, asOf: Date = new Date()): AttomLoan[] {
  const mortgage = findMortgageObject(prop);
  if (!mortgage) return [];

  const loans: AttomLoan[] = [];
  const first = mortgage.FirstConcurrent ?? mortgage.firstConcurrent;
  const second = mortgage.SecondConcurrent ?? mortgage.secondConcurrent;

  if (first && typeof first === "object") {
    const l = parseLoan(first as Record<string, unknown>, "first", asOf);
    if (l) loans.push(l);
  }
  if (second && typeof second === "object") {
    const l = parseLoan(second as Record<string, unknown>, "second", asOf);
    if (l) loans.push(l);
  }

  // Flat shape: the mortgage object itself carries amount/date (no concurrent nesting).
  if (loans.length === 0 && (pick(mortgage, ["amount", "loanAmount"]) != null || pick(mortgage, ["date", "recordingDate"]) != null)) {
    const l = parseLoan(mortgage, "first", asOf);
    if (l) loans.push(l);
  }

  return loans;
}

/**
 * Fetch the deed / mortgage record for an address and return parsed loans with
 * estimated outstanding balances. Returns null when ATTOM has no record. Throws
 * AttomError on a non-2xx response or when the key is not configured.
 */
export async function fetchMortgageRecord(address: string, asOf: Date = new Date()): Promise<AttomMortgageResult | null> {
  const key = process.env.ATTOM_API_KEY;
  if (!key) throw new AttomError("ATTOM_API_KEY is not configured on the server.", 500);

  const q = new URLSearchParams({ address });
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/property/detailmortgage?${q.toString()}`, {
      headers: { apikey: key, Accept: "application/json" },
    });
  } catch (e) {
    throw new AttomError(`ATTOM request failed: ${(e as Error).message}`, 502);
  }

  if (res.status === 400 || res.status === 404) {
    // ATTOM returns 400/404 (SuccessWithoutResult) for an address it has no record for.
    return null;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AttomError(
      res.status === 401 ? "ATTOM rejected the API key (401)." : `ATTOM error ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    );
  }

  const data = (await res.json()) as { status?: { code?: number; msg?: string }; property?: Record<string, unknown>[] };
  const props = Array.isArray(data.property) ? data.property : [];
  if (props.length === 0) return null;

  const prop = props[0];
  const loans = extractLoans(prop, asOf);

  const addrObj = prop.address as Record<string, unknown> | undefined;
  const resolvedAddr = (addrObj && (addrObj.oneLine ?? addrObj.line1)) ? String(addrObj.oneLine ?? addrObj.line1) : address;

  const estimates = loans.map((l) => l.estimatedBalance).filter((b): b is number => typeof b === "number");
  const totalEstimatedBalance = estimates.length ? estimates.reduce((a, b) => a + b, 0) : undefined;

  return { address: resolvedAddr, loans, totalEstimatedBalance, fetchedAt: new Date().toISOString() };
}
