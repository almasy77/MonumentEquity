import { NextRequest } from "next/server";
import { json, preflight, readParams } from "@/lib/mcp/http";
import { revokeByToken } from "@/lib/mcp/oauth-store";
import { allow, clientIp } from "@/lib/mcp/rate-limit";

// RFC 7009 token revocation. Revoking either token of a grant revokes the whole grant.
// Always answers 200 so it cannot be used to probe for valid tokens.
export async function POST(req: NextRequest) {
  if (!(await allow("oauth-revoke", clientIp(req), 30, 60))) return json({ error: "rate_limited" }, 429);
  const p = await readParams(req);
  if (p.token && p.client_id) await revokeByToken(p.token, p.client_id);
  return json({});
}

export function OPTIONS() {
  return preflight();
}
