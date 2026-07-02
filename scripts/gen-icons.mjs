// Generates the Monument Equity app icon set from a single on-brand SVG mark:
// a bold three-tower building (the app's Building logo motif) in blue on the
// brand navy (#020617). Outputs favicon.ico + PWA/apple PNGs. Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Brand mark (512×512) ─────────────────────────────────────────────
const NAVY = "#020617";
const BG = "#0B1220";     // slightly lifted navy so the icon reads on dark tabs
const BLUE = "#3B82F6";   // blue-500 (matches the in-app logo)
const BLUE_DK = "#2563EB";
const BLUE_LT = "#60A5FA";
const BASE = "#93C5FD";

// Window cutouts (navy) on the main tower — 3 rows × 2 cols, kept minimal so it
// stays legible at 16px.
const win = [];
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 2; c++) {
    const x = 214 + c * 42;
    const y = 168 + r * 56;
    win.push(`<rect x="${x}" y="${y}" width="26" height="30" rx="5" fill="${NAVY}"/>`);
  }
}

const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="${BG}"/>
  <rect x="120" y="224" width="82" height="176" rx="12" fill="${BLUE_DK}"/>
  <rect x="310" y="184" width="82" height="216" rx="12" fill="${BLUE_LT}"/>
  <rect x="190" y="120" width="132" height="280" rx="14" fill="${BLUE}"/>
  ${win.join("\n  ")}
  <rect x="96" y="388" width="320" height="26" rx="13" fill="${BASE}"/>
</svg>`;

const svgBuf = Buffer.from(svg);

async function png(size) {
  return sharp(svgBuf, { density: 384 }).resize(size, size).png().toBuffer();
}

// ── ICO builder (PNG-in-ICO; supported by all modern browsers) ───────
function buildIco(entries) {
  // entries: [{ size, buf }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const parts = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 0); // width
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.buf.length, o + 8); // size
    dir.writeUInt32LE(offset, o + 12); // offset
    offset += e.buf.length;
    parts.push(e.buf);
  });
  return Buffer.concat([header, dir, ...parts]);
}

const [p16, p32, p48, p180, p192, p512] = await Promise.all([
  png(16), png(32), png(48), png(180), png(192), png(512),
]);

writeFileSync(join(root, "src/app/icon.svg"), svgBuf);
writeFileSync(join(root, "src/app/favicon.ico"), buildIco([
  { size: 16, buf: p16 }, { size: 32, buf: p32 }, { size: 48, buf: p48 },
]));
writeFileSync(join(root, "src/app/apple-icon.png"), p180);
writeFileSync(join(root, "public/icons/icon-192.png"), p192);
writeFileSync(join(root, "public/icons/icon-512.png"), p512);

console.log("icons written: src/app/{icon.svg,favicon.ico,apple-icon.png}, public/icons/{icon-192,icon-512}.png");
