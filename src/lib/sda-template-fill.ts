/**
 * SDA template-fill engine — produces a byte-for-byte faithful copy of Michael
 * Blank's Syndicated Deal Analyzer (v2.9.4) with only the INPUT cells overwritten.
 *
 * Why not ExcelJS? ExcelJS cannot even re-save this template (it throws on the
 * conditional-formatting rules), and round-tripping a hand-built workbook through
 * any library drops advanced features (conditional formatting, data-validation
 * dropdowns, the embedded logo, comments, defined names, print settings). The only
 * way to keep "every cell, every font" exact is to treat the .xlsx as the zip it is
 * and edit ONLY the specific worksheet-XML cells that are user inputs. Everything we
 * don't touch — styles, formulas, CF, DV, drawings — is preserved verbatim.
 *
 * After injecting inputs we force a full recalculation on open (fullCalcOnLoad) and
 * drop the stale calc chain, so Excel recomputes every formula from the new inputs.
 */
import JSZip from "jszip";

export type SdaCellValue = number | string | boolean | null;

/** A set of cell writes targeting one sheet, keyed by A1 reference (e.g. "D6"). */
export interface SdaSheetWrite {
  sheet: string; // worksheet name as it appears in Excel, e.g. "Scenarios"
  cells: Record<string, SdaCellValue>;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Column letters → 1-based index, for ordering inserted cells within a row. */
function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref: ${ref}`);
  return { col: m[1], row: parseInt(m[2], 10) };
}

/** Build the replacement `<c>` element for a value, preserving the style attr. */
function buildCellXml(ref: string, styleAttr: string, value: SdaCellValue): string {
  const s = styleAttr ? ` ${styleAttr}` : "";
  if (value === null || value === undefined || value === "") {
    // Empty the cell but keep its style so formatting survives.
    return `<c r="${ref}"${s}/>`;
  }
  if (typeof value === "number") {
    // Guard against NaN/Infinity slipping into the XML (Excel would reject them).
    const num = Number.isFinite(value) ? value : 0;
    return `<c r="${ref}"${s}><v>${num}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  // String → inline string, so we never have to touch sharedStrings.xml.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

/** Extract the `s="…"` style attribute from a matched cell's opening tag, if any. */
function extractStyleAttr(openingAttrs: string): string {
  const m = /\bs="\d+"/.exec(openingAttrs);
  return m ? m[0] : "";
}

/**
 * Set one cell in a worksheet XML string. Replaces the existing cell in place
 * (preserving its style), or inserts it in column order if the cell is absent but
 * the row exists, or creates the row if the whole row is missing. Every input cell
 * we target already exists in the template, so the replace path is the common one;
 * the insert paths are defensive.
 */
function setCellInSheet(xml: string, ref: string, value: SdaCellValue): string {
  // 1) Cell exists — replace it, keeping its style attr.
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const cellMatch = cellRe.exec(xml);
  if (cellMatch) {
    const styleAttr = extractStyleAttr(cellMatch[1]);
    return xml.slice(0, cellMatch.index) + buildCellXml(ref, styleAttr, value) + xml.slice(cellMatch.index + cellMatch[0].length);
  }

  const { col, row } = splitRef(ref);
  const newCell = buildCellXml(ref, "", value);

  // 2) Row exists but the cell doesn't — insert the cell in column order.
  const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const rowMatch = rowRe.exec(xml);
  if (rowMatch) {
    const inner = rowMatch[2];
    const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)];
    let insertAt = inner.length; // default: append at end
    for (const c of cells) {
      if (colToNum(c[1]) > colToNum(col)) {
        insertAt = c.index ?? inner.length;
        break;
      }
    }
    const newInner = inner.slice(0, insertAt) + newCell + inner.slice(insertAt);
    return xml.slice(0, rowMatch.index) + rowMatch[1] + newInner + rowMatch[3] + xml.slice(rowMatch.index + rowMatch[0].length);
  }

  // 3) Row missing — insert a new <row> into <sheetData> in row order.
  const newRow = `<row r="${row}">${newCell}</row>`;
  const sheetDataRe = /(<sheetData[^>]*>)([\s\S]*?)(<\/sheetData>)/;
  const sd = sheetDataRe.exec(xml);
  if (!sd) return xml; // no sheetData — give up gracefully
  const rows = [...sd[2].matchAll(/<row r="(\d+)"/g)];
  let insertAt = sd[2].length;
  for (const r of rows) {
    if (parseInt(r[1], 10) > row) {
      insertAt = r.index ?? sd[2].length;
      break;
    }
  }
  const newBody = sd[2].slice(0, insertAt) + newRow + sd[2].slice(insertAt);
  return xml.slice(0, sd.index) + sd[1] + newBody + sd[3] + xml.slice(sd.index + sd[0].length);
}

/** Map worksheet display names → their `xl/worksheets/sheetN.xml` part paths. */
async function resolveSheetPaths(zip: JSZip): Promise<Record<string, string>> {
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");

  // r:id → target part (relative to xl/)
  const relTargets: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g)) {
    relTargets[m[1]] = m[2];
  }
  // Some generators order Id/Target the other way — cover both.
  for (const m of relsXml.matchAll(/<Relationship[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"[^>]*\/>/g)) {
    relTargets[m[2]] = m[1];
  }

  const out: Record<string, string> = {};
  for (const m of workbookXml.matchAll(/<sheet[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g)) {
    const name = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const target = relTargets[m[2]];
    if (target) out[name] = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  // Cover reversed attribute order (name after r:id).
  for (const m of workbookXml.matchAll(/<sheet[^>]*\br:id="([^"]+)"[^>]*\bname="([^"]+)"[^>]*\/>/g)) {
    const name = m[2].replace(/&amp;/g, "&");
    const target = relTargets[m[1]];
    if (target && !out[name]) out[name] = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  return out;
}

/** Force Excel to recalculate every formula when the workbook opens. */
function forceFullRecalc(workbookXml: string): string {
  if (/<calcPr\b/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*?)\/>/, (full, attrs) => {
      const a = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${a} fullCalcOnLoad="1"/>`;
    });
  }
  // No calcPr — add one just before </workbook>.
  return workbookXml.replace(/<\/workbook>/, `<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`);
}

/** Remove the calc chain so Excel rebuilds it from the recalculated formulas. */
async function dropCalcChain(zip: JSZip): Promise<void> {
  if (!zip.file("xl/calcChain.xml")) return;
  zip.remove("xl/calcChain.xml");
  // Drop its Content-Types override.
  const ctPath = "[Content_Types].xml";
  const ct = await zip.file(ctPath)?.async("string");
  if (ct) zip.file(ctPath, ct.replace(/<Override[^>]*calcChain\.xml"[^>]*\/>/g, ""));
  // Drop its workbook relationship.
  const relsPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relsPath)?.async("string");
  if (rels) zip.file(relsPath, rels.replace(/<Relationship[^>]*calcChain\.xml"[^>]*\/>/g, ""));
}

/**
 * Fill the SDA template with the given input-cell writes and return the populated
 * .xlsx as a Buffer. Only the referenced cells are changed; the rest of the file is
 * preserved exactly.
 */
export async function fillSdaTemplate(templateBytes: Buffer | ArrayBuffer | Uint8Array, writes: SdaSheetWrite[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBytes);
  const sheetPaths = await resolveSheetPaths(zip);

  for (const w of writes) {
    const path = sheetPaths[w.sheet];
    if (!path || !zip.file(path)) {
      throw new Error(`SDA template is missing worksheet "${w.sheet}"`);
    }
    let xml = await zip.file(path)!.async("string");
    for (const [ref, value] of Object.entries(w.cells)) {
      // A missing optional input (undefined) should leave the template's own default
      // in place rather than blank the cell or crash the export.
      if (value === undefined) continue;
      xml = setCellInSheet(xml, ref, value);
    }
    zip.file(path, xml);
  }

  // Recalculate on open, and clear the stale calc chain.
  const wbPath = "xl/workbook.xml";
  const wbXml = await zip.file(wbPath)!.async("string");
  zip.file(wbPath, forceFullRecalc(wbXml));
  await dropCalcChain(zip);

  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}
