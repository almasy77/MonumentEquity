import crypto from "node:crypto";

/**
 * Resend INBOUND email adapter (server-only). Resend's `email.received` webhook is
 * metadata-only and Svix-signed, so this module (1) verifies the Svix signature with
 * RESEND_WEBHOOK_SECRET, and (2) fetches the full message (body, headers, attachments)
 * from the Received-Email API with RESEND_API_KEY. The parsed result is handed to the
 * vendor-agnostic core in crm-email.ts, the same path the Postmark webhook uses.
 *
 * Docs: https://resend.com/docs/webhooks/emails/received
 *       https://resend.com/docs/api-reference/emails/retrieve-received-email
 *       https://resend.com/docs/webhooks/verify-webhooks-requests
 */

const API_BASE = "https://api.resend.com";

/** True when the keys needed to accept + fetch inbound Resend mail are configured. */
export function resendInboundConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_WEBHOOK_SECRET;
}

// ── Svix signature verification ─────────────────────────────────────────────
// Resend signs webhooks with Svix. Headers: svix-id, svix-timestamp, svix-signature.
// signed content = `${id}.${timestamp}.${rawBody}`; signature = base64 HMAC-SHA256 with
// the secret (the base64 payload after a "whsec_" prefix). The svix-signature header is
// a space-separated list of `v1,<base64sig>` entries.

const FIVE_MIN_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function verifyResendSignature(rawBody: string, headers: SvixHeaders, secret: string): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Reject stale/forged timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts > 1e12 ? ts : ts * 1000; // Svix sends seconds
  if (Math.abs(Date.now() - tsMs) > FIVE_MIN_MS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header may carry multiple space-separated versioned signatures.
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma === -1 ? part : part.slice(comma + 1);
    if (!sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// ── Received-email fetch ─────────────────────────────────────────────────────

export interface ResendReceivedAttachment {
  id?: string;
  filename?: string;
  content_type?: string;
  content_disposition?: string;
  content_id?: string;
  size?: number;
}

export interface ResendReceivedEmail {
  object?: string;
  id?: string;
  from?: string; // bare address
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  received_for?: string[];
  message_id?: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
  created_at?: string;
  headers?: Record<string, string>; // lowercase keys; headers.from = "Name <addr>"
  attachments?: ResendReceivedAttachment[];
}

export class ResendInboundError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ResendInboundError";
  }
}

/** Fetch the full received email by id (GET /emails/receiving/{id}). */
export async function fetchReceivedEmail(emailId: string): Promise<ResendReceivedEmail> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new ResendInboundError("RESEND_API_KEY is not configured.", 500);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  } catch (e) {
    throw new ResendInboundError(`Resend request failed: ${(e as Error).message}`, 502);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ResendInboundError(`Resend error ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as ResendReceivedEmail;
}

/** Parse a raw "Name <addr>" (or bare "addr") From header into name + email. */
export function parseAddressHeader(raw: string | undefined): { email: string; name?: string } {
  const s = (raw ?? "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return { email: m[2].trim().toLowerCase(), name: name || undefined };
  }
  return { email: s.toLowerCase() };
}
