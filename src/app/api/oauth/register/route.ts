import { NextRequest } from "next/server";
import { mcpDisabled } from "@/lib/mcp/oauth-config";
import { json, oauthError, preflight } from "@/lib/mcp/http";
import { OAuthError, registerClient } from "@/lib/mcp/oauth-store";
import { allow, clientIp } from "@/lib/mcp/rate-limit";

// RFC 7591 dynamic client registration. Open by design, but: redirect URIs must be on
// the allowlist (claude.ai / claude.com by default), clients are public (PKCE only,
// no secret), and a registered client grants nothing until a signed-in user approves.
export async function POST(req: NextRequest) {
  if (mcpDisabled()) return oauthError("temporarily_unavailable", "Connector is disabled", 503);
  if (!(await allow("oauth-register", clientIp(req), 10, 60))) {
    return oauthError("temporarily_unavailable", "Too many requests", 429);
  }
  const meta = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!meta || typeof meta !== "object") return oauthError("invalid_client_metadata", "Body must be JSON");
  try {
    const client = await registerClient(meta);
    return json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      },
      201
    );
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.code, e.message, e.status);
    throw e;
  }
}

export function OPTIONS() {
  return preflight();
}
