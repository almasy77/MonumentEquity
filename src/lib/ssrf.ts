// SSRF guard for server-side fetches of user-supplied URLs (listing imports).
// Blocks non-http(s) schemes and any URL that resolves to a private, loopback,
// link-local, or otherwise-reserved address — including via redirects, which are
// followed manually and re-validated at every hop. Without this a caller could
// point the importer at http://169.254.169.254/ (cloud metadata) or internal hosts.

import { lookup } from "node:dns/promises";
import net from "node:net";

// IPv4 reserved/private ranges as [network, prefixBits].
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 metadata)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32],
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = v4ToInt(ip);
  if (addr === null) return true; // unparseable → treat as unsafe
  for (const [net4, bits] of BLOCKED_V4) {
    const base = v4ToInt(net4)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) === (base & mask)) return true;
  }
  return false;
}

function isBlockedV6(ip: string): boolean {
  const a = ip.toLowerCase().split("%")[0]; // strip zone id
  if (a === "::1" || a === "::") return true; // loopback / unspecified
  if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
  // IPv4-mapped, either dotted (::ffff:a.b.c.d) or the URL-normalized hex form
  // (::ffff:7f00:1 == ::ffff:127.0.0.1) — validate the embedded v4 either way.
  let m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isBlockedV4(m[1]);
  m = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return isBlockedV4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedV6(address) : isBlockedV4(address);
}

/**
 * Validate that `raw` is an http(s) URL whose host resolves only to public
 * addresses. Throws a generic Error otherwise. Returns the parsed URL.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const literal = net.isIP(host); // 0 = hostname, 4 or 6 = IP literal
  if (literal !== 0) {
    if (isBlockedAddress(host, literal)) throw new Error("URL resolves to a non-public address");
    return u;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) throw new Error("URL host did not resolve");
  for (const { address, family } of resolved) {
    if (isBlockedAddress(address, family)) throw new Error("URL resolves to a non-public address");
  }
  return u;
}

/**
 * fetch() for user-supplied URLs, guarded against SSRF. Validates the URL, then
 * follows redirects MANUALLY (up to `maxRedirects`), re-validating each hop so a
 * public URL can't 302 into the internal network.
 */
export async function safeFetch(raw: string, init?: RequestInit, maxRedirects = 5): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href; // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
