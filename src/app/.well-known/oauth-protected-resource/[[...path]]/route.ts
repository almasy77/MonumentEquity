import { baseUrl, MCP_SCOPE, mcpDisabled, resourceUrl } from "@/lib/mcp/oauth-config";
import { json, preflight } from "@/lib/mcp/http";

// RFC 9728 protected resource metadata. Served at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp
// (clients try the path-suffixed form first).
export async function GET(req: Request) {
  if (mcpDisabled()) return json({ error: "disabled" }, 503);
  return json({
    resource: resourceUrl(req),
    authorization_servers: [baseUrl(req)],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Monument Equity underwriting app",
  });
}

export function OPTIONS() {
  return preflight();
}
