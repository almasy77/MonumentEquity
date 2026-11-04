import { baseUrl, MCP_SCOPE, mcpDisabled } from "@/lib/mcp/oauth-config";
import { json, preflight } from "@/lib/mcp/http";

// RFC 8414 authorization server metadata.
export async function GET(req: Request) {
  if (mcpDisabled()) return json({ error: "disabled" }, 503);
  const base = baseUrl(req);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true,
  });
}

export function OPTIONS() {
  return preflight();
}
