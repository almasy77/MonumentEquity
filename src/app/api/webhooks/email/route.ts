import { NextResponse } from "next/server";
import { getRedis, addToIndex } from "@/lib/db";
import { parseInboundEmail, type InboundEmail } from "@/lib/email-parser";
import type { PendingListing } from "@/lib/validations";

/**
 * POST /api/webhooks/email — Postmark inbound email webhook
 *
 * Postmark POSTs a JSON payload when an email arrives at the configured
 * inbound address. This webhook:
 *   1. Validates the optional secret header
 *   2. Parses the email body via Claude (ai-extract)
 *   3. Stores a PendingListing in the review queue (NOT a deal)
 *
 * Approval happens in /leads, which creates the deal from the pending item.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.get("x-postmark-secret");
    if (authHeader !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();

    const emailId = crypto.randomUUID();
    const inboundEmail: InboundEmail = {
      id: emailId,
      from: body.FromFull?.Email || body.From || "",
      from_name: body.FromFull?.Name || body.FromName || undefined,
      subject: body.Subject || "(No Subject)",
      text_body: body.TextBody || "",
      html_body: body.HtmlBody || undefined,
      attachments: body.Attachments?.map(
        (a: { Name: string; ContentType: string; ContentLength: number }) => ({
          name: a.Name,
          content_type: a.ContentType,
          content_length: a.ContentLength,
        })
      ),
      received_at: new Date().toISOString(),
    };

    const redis = getRedis();

    // Store raw email for audit (regardless of parse outcome)
    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({ ...inboundEmail, status: "processing" })
    );

    let parsed;
    try {
      parsed = await parseInboundEmail(inboundEmail);
    } catch (parseErr) {
      console.error("Email parsing failed:", parseErr);
      await redis.set(
        `inbound_email:${emailId}`,
        JSON.stringify({
          ...inboundEmail,
          status: "failed",
          error: parseErr instanceof Error ? parseErr.message : "Parse failed",
        })
      );
      // Return 200 so Postmark doesn't retry.
      return NextResponse.json({
        status: "failed",
        message: "Could not extract listing data from email",
      });
    }

    const now = new Date().toISOString();
    const pendingId = crypto.randomUUID();
    const pending: PendingListing = {
      id: pendingId,
      source_email_id: emailId,
      from: inboundEmail.from,
      from_name: inboundEmail.from_name,
      subject: inboundEmail.subject,
      received_at: inboundEmail.received_at,
      extracted: parsed.extracted,
      status: "pending",
      created_at: now,
      updated_at: now,
    };

    await redis.set(`pending_listing:${pendingId}`, JSON.stringify(pending));
    await addToIndex("pending_listings:queue", pendingId, Date.now());

    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({
        ...inboundEmail,
        status: "queued",
        pending_listing_id: pendingId,
      })
    );

    return NextResponse.json({
      status: "queued",
      pending_listing_id: pendingId,
    });
  } catch (err) {
    console.error("Email webhook error:", err);
    // Return 200 so Postmark doesn't retry on unexpected errors.
    return NextResponse.json({
      status: "error",
      message: err instanceof Error ? err.message : "Internal error",
    });
  }
}
