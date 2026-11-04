import { getEntity } from "@/lib/db";
import type { User } from "@/lib/validations";
import { baseUrl, mcpDisabled, resourceUrl } from "./oauth-config";
import { verifyAccessToken } from "./oauth-store";
import { allow } from "./rate-limit";

export interface McpAuthContext {
  userId: string;
  email: string;
  role: "admin" | "va" | "viewer";
  grantId: string;
}

export type AuthResult = { ok: true; ctx: McpAuthContext } | { ok: false; response: Response };

function unauthorized(req: Request, error?: string, description?: string): Response {
  const parts = [
    'Bearer realm="monument-equity"',
    `resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/api/mcp"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  return new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": parts.join(", "), "Cache-Control": "no-store" },
  });
}

/**
 * Authenticate an /api/mcp request. Every failure is a 401 with a WWW-Authenticate
 * challenge pointing at the protected-resource metadata, which is how an MCP client
 * (claude.ai) discovers it has to run the OAuth flow.
 */
export async function authenticateMcpRequest(req: Request): Promise<AuthResult> {
  if (mcpDisabled()) {
    return { ok: false, response: Response.json({ error: "Connector is disabled" }, { status: 503 }) };
  }
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { ok: false, response: unauthorized(req) };

  const verified = await verifyAccessToken(m[1]);
  if (!verified) return { ok: false, response: unauthorized(req, "invalid_token", "Token is invalid, expired or revoked") };
  // Audience binding (RFC 8707): the token must have been issued for this resource.
  if (verified.resource !== resourceUrl(req)) {
    return { ok: false, response: unauthorized(req, "invalid_token", "Token audience mismatch") };
  }

  // Resolve the user at call time so a deleted account or changed role takes effect immediately.
  const user = await getEntity<User>(`user:${verified.user_id}`);
  if (!user) return { ok: false, response: unauthorized(req, "invalid_token", "User no longer exists") };

  if (!(await allow("mcp-user", user.id, 300, 60))) {
    return { ok: false, response: Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "30" } }) };
  }

  return {
    ok: true,
    ctx: { userId: user.id, email: user.email, role: user.role ?? "viewer", grantId: verified.grant_id },
  };
}
