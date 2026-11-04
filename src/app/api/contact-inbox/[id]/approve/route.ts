import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { createContactFromParticipant, linkEmailToContact, clearPendingContactEmail } from "@/lib/crm-email";
import type { Contact, PendingContact } from "@/lib/validations";

/**
 * POST /api/contact-inbox/[id]/approve — create a contact from a pending item and
 * attach the correspondence that surfaced them. Body may override first_name,
 * last_name, company, type, tags before creating.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  const { id } = await params;
  const redis = getRedis();

  const pending = await redis.get<PendingContact>(`pending_contact:${id}`);
  if (!pending) {
    return NextResponse.json({ error: "Pending contact not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: `Already ${pending.status}` }, { status: 409 });
  }

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const overrides = (bodyOrError ?? {}) as Partial<Contact>;

  const contact = await createContactFromParticipant({
    email: pending.email,
    first_name: pending.first_name || pending.name || pending.email,
    last_name: pending.last_name,
    company: pending.company,
    overrides,
  });

  // Attach the originating correspondence to the new contact.
  await linkEmailToContact(pending.email_log_id, contact.id);

  const updated: PendingContact = {
    ...pending,
    status: "approved",
    approved_contact_id: contact.id,
    updated_at: new Date().toISOString(),
  };
  await redis.set(`pending_contact:${id}`, JSON.stringify(updated));
  await removeFromIndex("pending_contacts:queue", id);
  await clearPendingContactEmail(pending.email);

  return NextResponse.json({ contact_id: contact.id }, { status: 201 });
}
