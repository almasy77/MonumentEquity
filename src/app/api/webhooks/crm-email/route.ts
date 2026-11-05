import { NextResponse } from "next/server";
import { getRedis } from "@/lib/db";
import { getCrmEmailSettings } from "@/lib/crm-settings";
import {
  extractParticipants,
  buildEmailLog,
  findProcessedMessage,
  processInboundEmail,
} from "@/lib/crm-email";

/**
 * POST /api/webhooks/crm-email — Postmark inbound webhook for the CRM BCC address.
 *
 * BCC (or forward) an email conversation to the dedicated CRM address and this:
 *   1. validates the shared Postmark secret and dedupes by Message-ID,
 *   2. reads every participant (From/To/Cc) and drops our own staff + the inbound
 *      address,
 *   3. saves the conversation as an email log and attaches it to every external
 *      contact that matches by email (bumping last_contacted_at),
 *   4. for each unmatched external party, auto-creates a contact (when enabled) or
 *      queues a pending contact for confirmation in the CRM inbox.
 *
 * Returns 200 on handled outcomes so Postmark does not retry.
 */
export const maxDuration = 30;

export async function POST(req: Request) {
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("x-postmark-secret");
  if (authHeader !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const redis = getRedis();
    const now = new Date().toISOString();

    const messageId: string | undefined = body.MessageID || undefined;

    // Idempotency: the same BCC can be delivered more than once.
    const already = await findProcessedMessage(messageId);
    if (already) {
      return NextResponse.json({ status: "duplicate", email_log_id: already });
    }

    // Persist the raw inbound for audit.
    const emailId = crypto.randomUUID();
    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({ id: emailId, kind: "crm", message_id: messageId, received_at: now, status: "processing" }),
    );

    const settings = await getCrmEmailSettings();
    const participants = extractParticipants(body);

    const log = buildEmailLog({
      messageId,
      subject: body.Subject || "(No Subject)",
      from: body.FromFull?.Email || body.From || "",
      fromName: body.FromFull?.Name || body.FromName || undefined,
      to: (body.ToFull ?? []).map((a: { Email?: string }) => a.Email).filter(Boolean),
      cc: (body.CcFull ?? []).map((a: { Email?: string }) => a.Email).filter(Boolean),
      textBody: body.TextBody || "",
      htmlBody: body.HtmlBody || undefined,
      dateHeader: body.Date || undefined,
      receivedAt: now,
      attachments: (body.Attachments ?? []).map((a: { Name: string; ContentType: string; ContentLength: number }) => ({
        name: a.Name, content_type: a.ContentType, content_length: a.ContentLength,
      })),
      sourceEmailId: emailId,
    });

    const result = await processInboundEmail(participants, log, settings);

    if (result.status === "no_external") {
      // Only staff on the thread (or no parseable participants) — nothing to attach.
      await redis.set(`inbound_email:${emailId}`, JSON.stringify({ id: emailId, kind: "crm", message_id: messageId, received_at: now, status: "no_external" }));
      return NextResponse.json({ status: "no_external_parties" });
    }

    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({ id: emailId, kind: "crm", message_id: messageId, received_at: now, status: "logged", email_log_id: log.id }),
    );

    return NextResponse.json({
      status: "logged",
      email_log_id: log.id,
      attached: result.attached,
      created: result.created,
      queued: result.queued,
    });
  } catch (err) {
    console.error("CRM email webhook error:", err);
    // 200 so Postmark does not retry on unexpected errors.
    return NextResponse.json({ status: "error", message: "Internal error" });
  }
}
