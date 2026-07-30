// Safe, path-based edits for the AI assistant. The model returns a small list of
// { path, value } operations instead of rewriting the whole assumptions object
// (which timed out for large rent rolls). This applies them to a deep clone:
// supports object keys, array indices ("[0]"), and an array wildcard ("[*]" →
// every element). Never creates intermediate paths and refuses prototype-pollution
// keys, so a bad path changes nothing rather than corrupting the object.

export interface EditOp {
  path: string;
  value: unknown;
}

type PathSeg = { key: string } | { index: number } | { wildcard: true };
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function parsePath(path: string): PathSeg[] | null {
  if (typeof path !== "string") return null;
  const segs: PathSeg[] = [];
  for (const part of path.split(".")) {
    const m = part.match(/^([A-Za-z0-9_]+)(?:\[(\*|\d+)\])?$/);
    if (!m) return null;
    if (BANNED_KEYS.has(m[1])) return null;
    segs.push({ key: m[1] });
    if (m[2] !== undefined) segs.push(m[2] === "*" ? { wildcard: true } : { index: Number(m[2]) });
  }
  return segs.length > 0 ? segs : null;
}

function walkSet(node: unknown, segs: PathSeg[], value: unknown): number {
  if (node === null || typeof node !== "object") return 0;
  const seg = segs[0];
  const isLast = segs.length === 1;
  if ("wildcard" in seg) {
    if (!Array.isArray(node)) return 0;
    let c = 0;
    for (let i = 0; i < node.length; i++) {
      if (isLast) { node[i] = value; c++; }
      else c += walkSet(node[i], segs.slice(1), value);
    }
    return c;
  }
  if ("index" in seg) {
    if (!Array.isArray(node) || seg.index < 0 || seg.index >= node.length) return 0;
    if (isLast) { node[seg.index] = value; return 1; }
    return walkSet(node[seg.index], segs.slice(1), value);
  }
  const obj = node as Record<string, unknown>;
  if (isLast) { obj[seg.key] = value; return 1; }
  if (obj[seg.key] === null || typeof obj[seg.key] !== "object") return 0;
  return walkSet(obj[seg.key], segs.slice(1), value);
}

/** Apply one edit op to `root` in place. Returns the number of values changed. */
export function applyEdit(root: Record<string, unknown>, op: EditOp): number {
  if (!op || typeof op.path !== "string") return 0;
  const segs = parsePath(op.path);
  if (!segs) return 0;
  return walkSet(root, segs, op.value);
}

/** Apply a list of edit ops to `root` in place. Returns total values changed. */
export function applyAssumptionEdits(root: Record<string, unknown>, ops: EditOp[]): number {
  let applied = 0;
  for (const op of ops) applied += applyEdit(root, op);
  return applied;
}
