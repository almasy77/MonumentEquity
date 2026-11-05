import { NextResponse } from "next/server";
import { getRedis } from "@/lib/db";
import { getCrmEmailSettings } from "@/lib/crm-settings";
import {
  extractParticipants,
  buildEmailLog,
  findProcessedMessage,
  processInboundEmail,
} from "@/lib/crm-email";
import {
  resendInboundConfigured,
  verifyResendSignature,
  fetchReceivedEmail,
  parseAddressHeader,
} from "@/lib/resend-inbound";

/**
 * POST /api/webhooks/resend-inbound — Resend inbound webhook for the CRM address.
 *
 * Resend's `email.received` event is Svix-signed and metadata-only, so this:
 *   1. verifies the Svix signature with RESEND_WEBHOOK_SECRET (fail closed),
 *   2. dedupes by the email's Message-ID,
 *   3. fetches the full message (body, headers, attachments) from Resend,
 *   4. hands participants + a built email log to the shared CRM core, which attaches
 *      the conversation to matching contacts and auto-creates/queues the rest.
 *
 * Returns 200 on handled outcomes so Resend does not retry.
 */
export const maxDuration = 30;

interface ResendWebhookData {
  email_id?: string;
  message_id?: string;
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  created_at?: string;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !resendInboundConfigured()) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // Raw body is required for signature verification — read it before parsing.
  const raw = await req.text();
  const ok = verifyResendSignature(
    raw,
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    secret,
  );
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const event = JSON.parse(raw) as { type?: string; data?: ResendWebhookData };
    const data = event.data;
    // Only act on inbound-received events; acknowledge anything else.
    if (event.type !== "email.received" || !data?.email_id) {
      return NextResponse.json({ status: "ignored", type: event.type ?? null });
    }

    const redis = getRedis();
    const now = new Date().toISOString();

    // Prefer the real Message-ID for cross-vendor dedup; fall back to Resend's id.
    const dedupeId = data.message_id || data.email_id;
    const already = await findProcessedMessage(dedupeId);
    if (already) {
      return NextResponse.json({ status: "duplicate", email_log_id: already });
    }

    const emailId = crypto.randomUUID();
    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({ id: emailId, kind: "crm-resend", message_id: dedupeId, received_at: now, status: "processing" }),
    );

    // Fetch the full message (webhook is metadata-only).
    const full = await fetchReceivedEmail(data.email_id);

    const fromParsed = parseAddressHeader(full.headers?.from || full.from || data.from);
    const to = (full.to ?? data.to ?? []).filter(Boolean);
    const cc = (full.cc ?? data.cc ?? []).filter(Boolean);

    // Reuse the same participant extraction as Postmark via a normalized shape.
    const participants = extractParticipants({
      FromFull: { Email: fromParsed.email, Name: fromParsed.name },
      ToFull: to.map((e) => ({ Email: e })),
      CcFull: cc.map((e) => ({ Email: e })),
    });

    const settings = await getCrmEmailSettings();

    const log = buildEmailLog({
      messageId: dedupeId,
      subject: full.subject || data.subject || "(No Subject)",
      from: fromParsed.email,
      fromName: fromParsed.name,
      to,
      cc,
      textBody: full.text || "",
      htmlBody: full.html || undefined,
      dateHeader: full.created_at || data.created_at || undefined,
      receivedAt: now,
      attachments: (full.attachments ?? []).map((a) => ({
        name: a.filename ?? "attachment",
        content_type: a.content_type,
        content_length: a.size,
      })),
      sourceEmailId: emailId,
    });

    const result = await processInboundEmail(participants, log, settings);

    if (result.status === "no_external") {
      await redis.set(`inbound_email:${emailId}`, JSON.stringify({ id: emailId, kind: "crm-resend", message_id: dedupeId, received_at: now, status: "no_external" }));
      return NextResponse.json({ status: "no_external_parties" });
    }

    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({ id: emailId, kind: "crm-resend", message_id: dedupeId, received_at: now, status: "logged", email_log_id: log.id }),
    );

    return NextResponse.json({
      status: "logged",
      email_log_id: log.id,
      attached: result.attached,
      created: result.created,
      queued: result.queued,
    });
  } catch (err) {
    console.error("Resend inbound webhook error:", err);
    // 200 so Resend does not retry on unexpected errors.
    return NextResponse.json({ status: "error", message: "Internal error" });
  }
}
