import { extractDealFromText } from "./ai-extract";
import type { ExtractedDeal } from "./ai-extract";

export interface InboundEmail {
  id: string;
  from: string;
  from_name?: string;
  subject: string;
  text_body: string;
  html_body?: string;
  attachments?: Array<{
    name: string;
    content_type: string;
    content_length: number;
  }>;
  received_at: string;
}

export interface ParsedEmailResult {
  extracted: ExtractedDeal;
  source_email: string;
  source_subject: string;
  has_attachments: boolean;
}

/**
 * Parse an inbound email (from a broker forwarded to the app) and extract
 * deal information using Claude API.
 */
export async function parseInboundEmail(
  email: InboundEmail
): Promise<ParsedEmailResult> {
  // Build a context string from the email for AI extraction
  const emailContext = [
    `From: ${email.from_name || email.from}`,
    `Subject: ${email.subject}`,
    "",
    email.text_body || stripHtml(email.html_body || ""),
  ].join("\n");

  const extracted = await extractDealFromText(emailContext);

  // If no market_notes were extracted, use the email subject as a starting point
  if (!extracted.market_notes && email.subject) {
    extracted.market_notes = `Forwarded from: ${email.from_name || email.from}\nSubject: ${email.subject}`;
  }

  return {
    extracted,
    source_email: email.from,
    source_subject: email.subject,
    has_attachments: (email.attachments?.length ?? 0) > 0,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
