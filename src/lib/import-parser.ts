import ExcelJS from "exceljs";
import { DEAL_SOURCES } from "./constants";

export interface ImportRow {
  address: string;
  city: string;
  state: string;
  zip?: string;
  county?: string;
  units: number;
  asking_price: number;
  bid_price?: number;
  source: string;
  year_built?: number;
  property_type?: string;
  current_noi?: number;
  current_occupancy?: number;
  market_notes?: string;
}

export interface ParsedRow {
  row_number: number;
  data: Partial<ImportRow>;
  errors: string[];
  valid: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  valid_count: number;
  error_count: number;
}

const COLUMN_MAP: Record<string, keyof ImportRow> = {
  address: "address",
  street: "address",
  street_address: "address",
  "street address": "address",
  city: "city",
  state: "state",
  st: "state",
  zip: "zip",
  zipcode: "zip",
  "zip code": "zip",
  zip_code: "zip",
  county: "county",
  units: "units",
  "unit count": "units",
  unit_count: "units",
  "# units": "units",
  asking_price: "asking_price",
  "asking price": "asking_price",
  price: "asking_price",
  list_price: "asking_price",
  "list price": "asking_price",
  bid_price: "bid_price",
  "bid price": "bid_price",
  offer: "bid_price",
  source: "source",
  year_built: "year_built",
  "year built": "year_built",
  built: "year_built",
  property_type: "property_type",
  "property type": "property_type",
  type: "property_type",
  current_noi: "current_noi",
  "current noi": "current_noi",
  noi: "current_noi",
  current_occupancy: "current_occupancy",
  "current occupancy": "current_occupancy",
  occupancy: "current_occupancy",
  market_notes: "market_notes",
  "market notes": "market_notes",
  notes: "market_notes",
};

function normalizeHeader(raw: string): keyof ImportRow | null {
  const cleaned = raw.trim().toLowerCase().replace(/[*#]/g, "").trim();
  return COLUMN_MAP[cleaned] ?? null;
}

function matchSource(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  for (const src of DEAL_SOURCES) {
    if (src.toLowerCase() === lower) return src;
  }
  if (lower.includes("loopnet")) return "LoopNet";
  if (lower.includes("costar")) return "CoStar";
  if (lower.includes("crexi")) return "Crexi";
  if (lower.includes("broker")) return "Broker";
  if (lower.includes("off-market") || lower.includes("off market")) return "Off-Market";
  if (lower.includes("referral")) return "Referral";
  if (lower.includes("direct mail")) return "Direct Mail";
  if (lower.includes("driving")) return "Driving for Dollars";
  return null;
}

function validateRow(data: Partial<ImportRow>, rowNum: number): ParsedRow {
  const errors: string[] = [];

  if (!data.address?.trim()) errors.push("Address is required");
  if (!data.city?.trim()) errors.push("City is required");
  if (!data.state?.trim()) errors.push("State is required");

  if (data.units == null || isNaN(data.units)) {
    errors.push("Units is required and must be a number");
  } else if (data.units < 1 || !Number.isInteger(data.units)) {
    errors.push("Units must be a positive integer");
  }

  if (data.asking_price == null || isNaN(data.asking_price)) {
    errors.push("Asking price is required and must be a number");
  } else if (data.asking_price <= 0) {
    errors.push("Asking price must be positive");
  }

  if (!data.source) {
    errors.push("Source is required");
  } else {
    const matched = matchSource(data.source);
    if (!matched) {
      errors.push(`Invalid source "${data.source}". Valid: ${DEAL_SOURCES.join(", ")}`);
    } else {
      data.source = matched;
    }
  }

  if (data.current_occupancy != null && (data.current_occupancy < 0 || data.current_occupancy > 1)) {
    if (data.current_occupancy > 1 && data.current_occupancy <= 100) {
      data.current_occupancy = data.current_occupancy / 100;
    } else {
      errors.push("Occupancy must be between 0 and 1 (or 0-100%)");
    }
  }

  return {
    row_number: rowNum,
    data,
    errors,
    valid: errors.length === 0,
  };
}

function parseNumeric(val: unknown): number | undefined {
  if (val == null || val === "") return undefined;
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[$,%\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? undefined : n;
}

function parseString(val: unknown): string | undefined {
  if (val == null || val === "") return undefined;
  return String(val).trim();
}

export async function parseCSV(text: string): Promise<ParseResult> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], valid_count: 0, error_count: 0 };
  }

  const headerLine = lines[0];
  const headers = splitCSVLine(headerLine);
  const columnMapping: (keyof ImportRow | null)[] = headers.map(normalizeHeader);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]);
    if (cells.every((c) => !c.trim())) continue;

    const data: Partial<ImportRow> = {};
    for (let c = 0; c < columnMapping.length; c++) {
      const field = columnMapping[c];
      if (!field) continue;
      const raw = cells[c] ?? "";

      if (field === "units" || field === "asking_price" || field === "bid_price" ||
          field === "year_built" || field === "current_noi" || field === "current_occupancy") {
        const n = parseNumeric(raw);
        if (n != null) (data as Record<string, unknown>)[field] = n;
      } else {
        const s = parseString(raw);
        if (s) (data as Record<string, unknown>)[field] = s;
      }
    }

    rows.push(validateRow(data, i + 1));
  }

  return {
    rows,
    valid_count: rows.filter((r) => r.valid).length,
    error_count: rows.filter((r) => !r.valid).length,
  };
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    return { rows: [], valid_count: 0, error_count: 0 };
  }

  const headerRow = sheet.getRow(1);
  const columnMapping: (keyof ImportRow | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (_cell, colNum) => {
    while (columnMapping.length < colNum - 1) columnMapping.push(null);
    const val = headerRow.getCell(colNum).text || "";
    columnMapping.push(normalizeHeader(val));
  });

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const isEmpty = !row.values || (Array.isArray(row.values) && row.values.every((v) => v == null || v === ""));
    if (isEmpty) continue;

    const data: Partial<ImportRow> = {};
    for (let c = 0; c < columnMapping.length; c++) {
      const field = columnMapping[c];
      if (!field) continue;
      const cell = row.getCell(c + 1);
      const raw = cell.value;

      if (field === "units" || field === "asking_price" || field === "bid_price" ||
          field === "year_built" || field === "current_noi" || field === "current_occupancy") {
        const n = parseNumeric(raw);
        if (n != null) (data as Record<string, unknown>)[field] = n;
      } else {
        const s = parseString(raw);
        if (s) (data as Record<string, unknown>)[field] = s;
      }
    }

    rows.push(validateRow(data, r));
  }

  return {
    rows,
    valid_count: rows.filter((r) => r.valid).length,
    error_count: rows.filter((r) => !r.valid).length,
  };
}

export async function generateTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Properties");

  sheet.columns = [
    { header: "Address *", key: "address", width: 30 },
    { header: "City *", key: "city", width: 15 },
    { header: "State *", key: "state", width: 8 },
    { header: "ZIP", key: "zip", width: 10 },
    { header: "Units *", key: "units", width: 8 },
    { header: "Asking Price *", key: "asking_price", width: 15 },
    { header: "Source *", key: "source", width: 15 },
    { header: "Bid Price", key: "bid_price", width: 15 },
    { header: "Year Built", key: "year_built", width: 10 },
    { header: "Property Type", key: "property_type", width: 15 },
    { header: "County", key: "county", width: 15 },
    { header: "Current NOI", key: "current_noi", width: 12 },
    { header: "Occupancy", key: "current_occupancy", width: 10 },
    { header: "Notes", key: "market_notes", width: 30 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

  sheet.addRow({
    address: "123 Main St",
    city: "Durham",
    state: "NC",
    zip: "27701",
    units: 12,
    asking_price: 1500000,
    source: "Broker",
    year_built: 1985,
    property_type: "Multifamily",
  });

  sheet.addRow({
    address: "456 Oak Ave",
    city: "Raleigh",
    state: "NC",
    zip: "27603",
    units: 24,
    asking_price: 3200000,
    source: "LoopNet",
    bid_price: 2900000,
    year_built: 1992,
    property_type: "Multifamily",
    current_noi: 180000,
    current_occupancy: 0.94,
  });

  const sourceSheet = workbook.addWorksheet("Valid Sources");
  sourceSheet.addRow(["Valid Source Values"]);
  sourceSheet.getRow(1).font = { bold: true };
  DEAL_SOURCES.forEach((s) => sourceSheet.addRow([s]));

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
