import { NextResponse } from "next/server";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { parseInboundEmail, type InboundEmail } from "@/lib/email-parser";
import type { Deal } from "@/lib/validations";

// System user ID for automated actions
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * POST /api/webhooks/email — Postmark inbound email webhook
 *
 * Postmark sends a JSON payload when an email is received at the
 * configured inbound address. This webhook:
 * 1. Validates the webhook (optional secret header)
 * 2. Parses the email content via Claude API
 * 3. Creates a new deal in "lead" stage with extracted data
 * 4. Stores the raw email for audit
 */
export async function POST(req: Request) {
  // Optional webhook secret validation
  const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.get("x-postmark-secret");
    if (authHeader !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();

    // Map Postmark payload to our InboundEmail type
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

    // Store raw email for audit
    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({
        ...inboundEmail,
        status: "processing",
      })
    );

    // Parse and extract deal data
    let parsed;
    try {
      parsed = await parseInboundEmail(inboundEmail);
    } catch (parseErr) {
      console.error("Email parsing failed:", parseErr);
      // Update email status to failed
      await redis.set(
        `inbound_email:${emailId}`,
        JSON.stringify({
          ...inboundEmail,
          status: "failed",
          error:
            parseErr instanceof Error ? parseErr.message : "Parse failed",
        })
      );

      // Still return 200 so Postmark doesn't retry
      return NextResponse.json({
        status: "failed",
        message: "Could not extract deal data from email",
      });
    }

    const { extracted } = parsed;
    const now = new Date().toISOString();
    const dealId = crypto.randomUUID();

    // Create deal from extracted data — defaults for missing required fields
    const deal: Deal = {
      id: dealId,
      user_id: SYSTEM_USER_ID,
      stage: "lead",
      status: "active",
      address: extracted.address || `Email Lead: ${inboundEmail.subject}`,
      city: extracted.city || "Unknown",
      state: extracted.state || "NC",
      zip: extracted.zip,
      units: extracted.units || 1,
      year_built: extracted.year_built,
      property_type: extracted.property_type,
      square_footage: extracted.square_footage,
      asking_price: extracted.asking_price || 0,
      source: "Broker",
      market_notes: [
        extracted.market_notes,
        `\n--- Imported from email ---`,
        `From: ${inboundEmail.from_name || inboundEmail.from}`,
        `Subject: ${inboundEmail.subject}`,
        `Date: ${inboundEmail.received_at}`,
      ]
        .filter(Boolean)
        .join("\n"),
      contact_ids: [],
      created_by: SYSTEM_USER_ID,
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };

    await redis.set(`deal:${dealId}`, JSON.stringify(deal));
    await addToIndex("deals:active", dealId, Date.now());
    await addToIndex("deals:by_stage:lead", dealId, Date.now());

    await logActivity({
      deal_id: dealId,
      action: "deal_created_from_email",
      entity_type: "deal",
      entity_id: dealId,
      details: {
        email_from: inboundEmail.from,
        email_subject: inboundEmail.subject,
        inbound_email_id: emailId,
      },
      user_id: SYSTEM_USER_ID,
    });

    // Update email status to processed
    await redis.set(
      `inbound_email:${emailId}`,
      JSON.stringify({
        ...inboundEmail,
        status: "processed",
        parsed_deal_id: dealId,
      })
    );

    return NextResponse.json({
      status: "processed",
      deal_id: dealId,
    });
  } catch (err) {
    console.error("Email webhook error:", err);
    // Return 200 to prevent Postmark retries on unexpected errors
    return NextResponse.json({
      status: "error",
      message: err instanceof Error ? err.message : "Internal error",
    });
  }
}
