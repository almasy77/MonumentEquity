/**
 * Validation + tamper-proofing for the OAuth authorization request.
 *
 * The consent page validates the incoming query once, then embeds the validated
 * parameters in the approve form together with an HMAC bound to the signed-in user.
 * The decision endpoint trusts nothing else: it re-verifies the HMAC, so the
 * redirect_uri / code_challenge shown on the consent screen are exactly the ones used.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getClient, type OAuthClient } from "./oauth-store";
import { resourceMatches } from "./oauth-config";

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams; client: OAuthClient }
  // Errors are always shown to the user, never redirected: the redirect_uri is only
  // trustworthy once it has matched the registered client, and any failure here may
  // precede (or be) that check.
  | { ok: false; error: string; description: string };

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function validateAuthorizeRequest(raw: Raw, req?: Request): Promise<AuthorizeValidation> {
  const fail = (error: string, description: string): AuthorizeValidation => ({ ok: false, error, description });

  const client_id = one(raw.client_id);
  const redirect_uri = one(raw.redirect_uri);
  if (!client_id || !redirect_uri) return fail("invalid_request", "client_id and redirect_uri are required.");

  const client = await getClient(client_id);
  if (!client) return fail("invalid_client", "Unknown client. Remove and re-add the connector in Claude.");
  if (!client.redirect_uris.includes(redirect_uri)) {
    return fail("invalid_request", "redirect_uri does not match the registered client.");
  }

  if (one(raw.response_type) !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const code_challenge = one(raw.code_challenge);
  if (one(raw.code_challenge_method) !== "S256" || !code_challenge || !/^[A-Za-z0-9\-_]{43}$/.test(code_challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  const resource = one(raw.resource);
  if (resource && !resourceMatches(resource, req)) return fail("invalid_target", "Unknown resource.");

  const state = one(raw.state);
  if (state && state.length > 2000) return fail("invalid_request", "state is too long.");

  return {
    ok: true,
    client,
    params: { client_id, redirect_uri, code_challenge, state, scope: one(raw.scope), resource },
  };
}

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function mac(userId: string, payload: string): Buffer {
  return createHmac("sha256", secret()).update(`mcp-authorize:${userId}:${payload}`).digest();
}

export function signAuthorizeParams(userId: string, params: AuthorizeParams): { request: string; sig: string } {
  const request = Buffer.from(JSON.stringify(params)).toString("base64url");
  return { request, sig: mac(userId, request).toString("base64url") };
}

export function verifyAuthorizeParams(userId: string, request: string, sig: string): AuthorizeParams | null {
  try {
    const expected = mac(userId, request);
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return JSON.parse(Buffer.from(request, "base64url").toString("utf8")) as AuthorizeParams;
  } catch {
    return null;
  }
}

/** Build the redirect back to the client (success or error), per RFC 6749 §4.1.2 + RFC 9207. */
export function clientRedirect(
  params: AuthorizeParams,
  result: { code: string } | { error: string; description?: string },
  issuer: string
): string {
  const u = new URL(params.redirect_uri);
  if ("code" in result) u.searchParams.set("code", result.code);
  else {
    u.searchParams.set("error", result.error);
    if (result.description) u.searchParams.set("error_description", result.description);
  }
  if (params.state) u.searchParams.set("state", params.state);
  u.searchParams.set("iss", issuer);
  return u.toString();
}
