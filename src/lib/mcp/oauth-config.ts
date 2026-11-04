/**
 * Configuration for the connector's OAuth 2.1 authorization server + MCP resource.
 *
 * Env (all optional):
 *   MCP_PUBLIC_URL                 Public origin, e.g. https://app.monumentequity.com.
 *                                  Falls back to NEXTAUTH_URL, then the request origin.
 *   MCP_DISABLED=1                 Kill switch: the endpoint and token issuance return 503.
 *   MCP_ALLOWED_REDIRECT_HOSTS     Comma list of hosts a client may redirect back to.
 *                                  Default: claude.ai,claude.com. Add "localhost" to
 *                                  allow loopback http redirects (dev / MCP Inspector).
 */

export const MCP_SCOPE = "monument";
export const MCP_PATH = "/api/mcp";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, sliding (rotated on use)
export const AUTH_CODE_TTL_SECONDS = 10 * 60;
export const CLIENT_TTL_SECONDS = 60 * 60 * 24 * 365;

export function mcpDisabled(): boolean {
  return process.env.MCP_DISABLED === "1";
}

/** Public origin with no trailing slash. */
export function baseUrl(req?: Request): string {
  const configured = process.env.MCP_PUBLIC_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (req) {
    const h = req.headers;
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
    return new URL(req.url).origin;
  }
  return "http://localhost:3000";
}

/** The canonical MCP resource identifier (RFC 8707 audience) for this deployment. */
export function resourceUrl(req?: Request): string {
  return `${baseUrl(req)}${MCP_PATH}`;
}

/**
 * Does a client-supplied RFC 8707 `resource` identify this MCP server? Clients differ in
 * what they send (the full MCP URL, the bare origin, a trailing slash), so accept the
 * canonical URL or the origin, compared case-insensitively on scheme/host and ignoring
 * trailing slashes. Tokens are always bound to the canonical resourceUrl(), never to what
 * the client sent.
 */
export function resourceMatches(provided: string, req?: Request): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return null;
    }
  };
  const p = norm(provided);
  return p !== null && (p === norm(resourceUrl(req)) || p === norm(baseUrl(req)));
}

export function allowedRedirectHosts(): string[] {
  const raw = process.env.MCP_ALLOWED_REDIRECT_HOSTS || "claude.ai,claude.com";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A redirect URI is acceptable when it is an absolute https URL (http only for an
 * explicitly allowed loopback host) on an allowlisted host, with no credentials or
 * fragment. Exact-match against the registered URI is enforced separately.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  const host = u.hostname.toLowerCase();
  const hostWithBrackets = host.includes(":") ? `[${host}]` : host;
  const allowed = allowedRedirectHosts();
  if (!allowed.includes(host) && !allowed.includes(hostWithBrackets)) return false;
  if (LOOPBACK.has(hostWithBrackets)) return u.protocol === "http:" || u.protocol === "https:";
  return u.protocol === "https:";
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
