import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { baseUrl, mcpDisabled, resourceUrl } from "@/lib/mcp/oauth-config";
import { clientRedirect, verifyAuthorizeParams, validateAuthorizeRequest } from "@/lib/mcp/authorize-request";
import { issueAuthorizationCode } from "@/lib/mcp/oauth-store";
import { allow } from "@/lib/mcp/rate-limit";

// POST /api/oauth/authorize — the consent form's target. Requires the signed-in app
// session, a same-origin POST, and the HMAC-signed parameters minted by the consent
// page for THIS user; only then is a one-time authorization code issued.
export async function POST(req: NextRequest) {
  if (mcpDisabled()) return NextResponse.json({ error: "Connector is disabled" }, { status: 503 });

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // CSRF: the session cookie is SameSite=Lax (not sent on cross-site POSTs); also require a same-origin Origin.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  if (!(await allow("oauth-authorize", session.user.id, 20, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const request = form?.get("request");
  const sig = form?.get("sig");
  const decision = form?.get("decision");
  if (typeof request !== "string" || typeof sig !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const params = verifyAuthorizeParams(session.user.id, request, sig);
  if (!params) return NextResponse.json({ error: "Invalid or tampered request" }, { status: 400 });

  // Re-validate against the live client record (it may have expired since the page rendered).
  const v = await validateAuthorizeRequest(
    { ...params, response_type: "code", code_challenge_method: "S256" },
    req
  );
  if (!v.ok) return NextResponse.json({ error: v.error, error_description: v.description }, { status: 400 });

  const issuer = baseUrl(req);
  if (decision !== "approve") {
    return NextResponse.redirect(clientRedirect(v.params, { error: "access_denied" }, issuer), 303);
  }

  const code = await issueAuthorizationCode({
    client: v.client,
    user_id: session.user.id,
    redirect_uri: v.params.redirect_uri,
    code_challenge: v.params.code_challenge,
    resource: resourceUrl(req),
  });
  return NextResponse.redirect(clientRedirect(v.params, { code }, issuer), 303);
}
