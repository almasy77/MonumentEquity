import { NextRequest } from "next/server";
import { mcpDisabled, resourceMatches, resourceUrl } from "@/lib/mcp/oauth-config";
import { json, oauthError, preflight, readParams } from "@/lib/mcp/http";
import {
  OAuthError,
  exchangeAuthorizationCode,
  getClient,
  refreshTokens,
} from "@/lib/mcp/oauth-store";
import { allow, clientIp } from "@/lib/mcp/rate-limit";

// OAuth 2.1 token endpoint: authorization_code (PKCE S256 required) and refresh_token
// (rotating, single-use). Clients are public; there is no client secret.
export async function POST(req: NextRequest) {
  if (mcpDisabled()) return oauthError("temporarily_unavailable", "Connector is disabled", 503);
  if (!(await allow("oauth-token", clientIp(req), 30, 60))) {
    return oauthError("temporarily_unavailable", "Too many requests", 429);
  }
  const p = await readParams(req);
  const clientId = p.client_id;
  if (!clientId || !(await getClient(clientId))) {
    return oauthError("invalid_client", "Unknown client_id", 401);
  }

  try {
    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.redirect_uri || !p.code_verifier) {
        return oauthError("invalid_request", "code, redirect_uri and code_verifier are required");
      }
      const tokens = await exchangeAuthorizationCode({
        code: p.code,
        client_id: clientId,
        redirect_uri: p.redirect_uri,
        code_verifier: p.code_verifier,
        // Accept equivalent spellings of our resource; anything else fails the store's check.
        resource: p.resource && resourceMatches(p.resource, req) ? resourceUrl(req) : p.resource,
        expectedResource: resourceUrl(req),
      });
      return json(tokens);
    }
    if (p.grant_type === "refresh_token") {
      if (!p.refresh_token) return oauthError("invalid_request", "refresh_token is required");
      return json(await refreshTokens({ refresh_token: p.refresh_token, client_id: clientId }));
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.code, e.message, e.status);
    throw e;
  }
}

export function OPTIONS() {
  return preflight();
}
