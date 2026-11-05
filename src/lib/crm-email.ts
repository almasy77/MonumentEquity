import { getRedis, addToIndex } from "@/lib/db";
import { isInternalAddress, type CrmEmailSettings } from "@/lib/crm-settings";
import type { Contact, EmailLog, PendingContact } from "@/lib/validations";

/**
 * CRM email logging: turn a BCC'd / forwarded email into correspondence attached
 * to the right contact(s). Participants are read from From/To/Cc; our own staff
 * and the inbound address are filtered out; each remaining external party is
 * matched to a contact (or queued for creation). Pure helpers are exported for
 * tests; the Redis helpers do the persistence.
 */

export interface Participant {
  email: string; // lowercased
  name?: string;
}

const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "msn.com",
]);

export function normalizeEmail(raw: string | undefined | null): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Split a display name (and fall back to the email local part) into first/last. */
export function parsePersonName(name: string | undefined, email: string): {
  first_name: string;
  last_name?: string;
  display: string;
} {
  let n = (name ?? "").trim().replace(/^["']|["']$/g, "").trim();
  // "Last, First" → "First Last"
  if (n.includes(",")) {
    const [last, first] = n.split(",", 2).map((s) => s.trim());
    if (first && last) n = `${first} ${last}`;
  }
  if (!n || n.includes("@")) {
    // Derive from the local part: "jane.doe" / "jane_doe" / "jane-doe" → "Jane Doe"
    const local = normalizeEmail(email).split("@")[0] || "";
    n = local
      .replace(/[._-]+/g, " ")
      .replace(/\d+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
      .trim();
  }
  if (!n) n = email;
  const parts = n.split(/\s+/);
  const first_name = parts[0] || email;
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  return { first_name, last_name, display: n };
}

/** Guess a company name from the email domain, skipping freemail providers. */
export function guessCompanyFromEmail(email: string): string | undefined {
  const domain = normalizeEmail(email).split("@")[1];
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return undefined;
  const core = domain.split(".").slice(0, -1).join(".") || domain;
  return core
    .split(/[.-]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim() || undefined;
}

interface AddressFull { Email?: string; Name?: string }

/** Pull participants from a Postmark inbound payload (From + To + Cc). */
export function extractParticipants(payload: {
  FromFull?: AddressFull;
  From?: string;
  FromName?: string;
  ToFull?: AddressFull[];
  CcFull?: AddressFull[];
}): Participant[] {
  const out: Participant[] = [];
  const push = (a: AddressFull | undefined) => {
    const email = normalizeEmail(a?.Email);
    if (email) out.push({ email, name: a?.Name?.trim() || undefined });
  };
  if (payload.FromFull?.Email) push(payload.FromFull);
  else if (payload.From) push({ Email: payload.From, Name: payload.FromName });
  (payload.ToFull ?? []).forEach(push);
  (payload.CcFull ?? []).forEach(push);

  // Dedupe by email, keeping the first name we saw for each.
  const seen = new Map<string, Participant>();
  for (const p of out) {
    const existing = seen.get(p.email);
    if (!existing) seen.set(p.email, p);
    else if (!existing.name && p.name) existing.name = p.name;
  }
  return Array.from(seen.values());
}

/** The external parties (non-staff, non-inbound) on a thread — who we attach to. */
export function selectExternalParticipants(
  participants: Participant[],
  settings: CrmEmailSettings,
): Participant[] {
  return participants.filter((p) => !isInternalAddress(p.email, settings));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

// ── Redis helpers ───────────────────────────────────────────

const msgidKey = (messageId: string) => `email_log:msgid:${messageId}`;
const contactEmailsIndex = (contactId: string) => `contact:emails:${contactId}`;

/** Returns the existing email-log id if this Message-ID was already processed. */
export async function findProcessedMessage(messageId: string | undefined): Promise<string | null> {
  if (!messageId) return null;
  try {
    return await getRedis().get<string>(msgidKey(messageId));
  } catch {
    return null;
  }
}

/** Load all contacts once and build a lowercased email → contact map. */
export async function findContactsByEmails(emails: string[]): Promise<Map<string, Contact>> {
  const want = new Set(emails.map(normalizeEmail).filter(Boolean));
  const result = new Map<string, Contact>();
  if (want.size === 0) return result;

  const redis = getRedis();
  const ids = await redis.zrange<string[]>("contacts:all", 0, -1);
  if (!ids || ids.length === 0) return result;

  // Batch-load in chunks to keep the pipeline reasonable.
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const pipeline = redis.pipeline();
    for (const id of slice) pipeline.get<Contact>(`contact:${id}`);
    const rows = (await pipeline.exec<(Contact | null)[]>()) ?? [];
    for (const c of rows) {
      const e = normalizeEmail(c?.email);
      if (c && e && want.has(e) && !result.has(e)) result.set(e, c);
    }
  }
  return result;
}

export interface BuildLogInput {
  messageId?: string;
  subject: string;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  textBody: string;
  htmlBody?: string;
  dateHeader?: string;
  receivedAt: string;
  attachments?: { name: string; content_type?: string; content_length?: number }[];
  sourceEmailId?: string;
}

/** Build (but do not persist) an EmailLog from parsed fields. */
export function buildEmailLog(input: BuildLogInput): EmailLog {
  const body = input.textBody || stripHtml(input.htmlBody ?? "");
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 280);
  const sentAt = toIso(input.dateHeader, input.receivedAt);
  return {
    id: crypto.randomUUID(),
    message_id: input.messageId,
    direction: "logged",
    subject: input.subject || "(No Subject)",
    from: normalizeEmail(input.from),
    from_name: input.fromName,
    to: input.to.map(normalizeEmail).filter(Boolean),
    cc: input.cc.map(normalizeEmail).filter(Boolean),
    text_body: body,
    html_body: input.htmlBody,
    snippet,
    sent_at: sentAt,
    received_at: input.receivedAt,
    contact_ids: [],
    attachments: (input.attachments ?? []).map((a) => ({
      name: a.name,
      content_type: a.content_type,
      content_length: a.content_length,
    })),
    source: "bcc",
    source_email_id: input.sourceEmailId,
    created_at: new Date().toISOString(),
  };
}

/** Persist the email log, link it to the given contacts, and bump last_contacted_at. */
export async function saveEmailLog(log: EmailLog, contactIds: string[]): Promise<void> {
  const redis = getRedis();
  const finalLog: EmailLog = { ...log, contact_ids: Array.from(new Set(contactIds)) };
  await redis.set(`email_log:${finalLog.id}`, JSON.stringify(finalLog));

  const score = new Date(finalLog.sent_at).getTime() || Date.now();
  for (const cid of finalLog.contact_ids) {
    await addToIndex(contactEmailsIndex(cid), finalLog.id, score);
    try {
      const contact = await redis.get<Contact>(`contact:${cid}`);
      if (contact) {
        const prev = contact.last_contacted_at ? new Date(contact.last_contacted_at).getTime() : 0;
        if (score > prev) {
          await redis.set(`contact:${cid}`, JSON.stringify({ ...contact, last_contacted_at: finalLog.sent_at, updated_at: new Date().toISOString() }));
        }
      }
    } catch {
      // non-fatal: the log is still saved and indexed
    }
  }

  if (finalLog.message_id) {
    try { await redis.set(msgidKey(finalLog.message_id), finalLog.id); } catch { /* non-fatal */ }
  }
}

/** Attach an already-saved email log to one more contact (used on pending-contact approval). */
export async function linkEmailToContact(emailLogId: string, contactId: string): Promise<void> {
  const redis = getRedis();
  const log = await redis.get<EmailLog>(`email_log:${emailLogId}`);
  if (!log) return;
  if (!log.contact_ids.includes(contactId)) {
    const updated: EmailLog = { ...log, contact_ids: [...log.contact_ids, contactId] };
    await redis.set(`email_log:${emailLogId}`, JSON.stringify(updated));
  }
  const score = new Date(log.sent_at).getTime() || Date.now();
  await addToIndex(contactEmailsIndex(contactId), emailLogId, score);
}

/** List a contact's correspondence, newest first. */
export async function getContactEmails(contactId: string, limit = 50): Promise<EmailLog[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(contactEmailsIndex(contactId), 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.get<EmailLog>(`email_log:${id}`);
  const rows = (await pipeline.exec<(EmailLog | null)[]>()) ?? [];
  return rows.filter((x): x is EmailLog => !!x);
}

/**
 * Create a contact from an external party (used by the auto-create path and by
 * pending-contact approval). Defaults to type "other"; overrides win.
 */
export async function createContactFromParticipant(params: {
  email: string;
  first_name: string;
  last_name?: string;
  company?: string;
  overrides?: Partial<Contact>;
}): Promise<Contact> {
  const now = new Date().toISOString();
  const first_name = params.overrides?.first_name || params.first_name;
  const last_name = params.overrides?.last_name ?? params.last_name;
  const display = [first_name, last_name].filter(Boolean).join(" ").trim() || params.email;
  const contact: Contact = {
    id: crypto.randomUUID(),
    first_name,
    last_name: last_name || undefined,
    name: display,
    company: params.overrides?.company ?? params.company,
    type: params.overrides?.type ?? "other",
    tags: params.overrides?.tags ?? [],
    email: params.email,
    phones: [],
    deal_ids: [],
    connection_source: params.overrides?.connection_source ?? "Email (auto-logged)",
    created_at: now,
    updated_at: now,
  };
  const redis = getRedis();
  await redis.set(`contact:${contact.id}`, JSON.stringify(contact));
  await addToIndex("contacts:all", contact.id, Date.now());
  await addToIndex(`contacts:by_type:${contact.type}`, contact.id, Date.now());
  return contact;
}

const pendingContactEmailKey = (email: string) => `pending_contact:email:${normalizeEmail(email)}`;

/** The id of an open pending-contact for this email, if one already exists. */
export async function findOpenPendingContact(email: string): Promise<string | null> {
  try {
    return await getRedis().get<string>(pendingContactEmailKey(email));
  } catch {
    return null;
  }
}

/** Create a pending-contact review item for an unmatched external party. */
export async function createPendingContact(params: {
  participant: Participant;
  emailLogId: string;
  subject: string;
  from: string;
  receivedAt: string;
}): Promise<PendingContact> {
  const { participant, emailLogId, subject, from, receivedAt } = params;
  const parsed = parsePersonName(participant.name, participant.email);
  const now = new Date().toISOString();
  const pc: PendingContact = {
    id: crypto.randomUUID(),
    email: participant.email,
    name: parsed.display,
    first_name: parsed.first_name,
    last_name: parsed.last_name,
    company: guessCompanyFromEmail(participant.email),
    email_log_id: emailLogId,
    subject,
    from: normalizeEmail(from),
    received_at: receivedAt,
    status: "pending",
    created_at: now,
    updated_at: now,
  };
  const redis = getRedis();
  await redis.set(`pending_contact:${pc.id}`, JSON.stringify(pc));
  await addToIndex("pending_contacts:queue", pc.id, Date.now());
  try { await redis.set(pendingContactEmailKey(pc.email), pc.id); } catch { /* non-fatal dedup */ }
  return pc;
}

/** Clear the per-email dedup marker when a pending contact is resolved. */
export async function clearPendingContactEmail(email: string): Promise<void> {
  try { await getRedis().del(pendingContactEmailKey(email)); } catch { /* non-fatal */ }
}

export interface InboundProcessResult {
  status: "logged" | "no_external";
  attached: number; // matched contacts the log was attached to
  created: number; // contacts auto-created
  queued: number; // pending contacts queued for review
}

/**
 * Vendor-agnostic core shared by every inbound webhook (Postmark, Resend, …):
 * given the thread's participants and a built email log, attach the log to every
 * external contact that matches and, for the rest, auto-create or queue per settings.
 * Does nothing (and saves no log) when only staff are on the thread.
 */
export async function processInboundEmail(
  participants: Participant[],
  log: EmailLog,
  settings: CrmEmailSettings,
): Promise<InboundProcessResult> {
  const external = selectExternalParticipants(participants, settings);
  if (external.length === 0) return { status: "no_external", attached: 0, created: 0, queued: 0 };

  const matches = await findContactsByEmails(external.map((p) => p.email));

  const matchedContactIds: string[] = [];
  for (const p of external) {
    const contact = matches.get(p.email);
    if (contact) matchedContactIds.push(contact.id);
  }
  await saveEmailLog(log, matchedContactIds);

  let created = 0;
  let queued = 0;
  for (const p of external) {
    if (matches.has(p.email)) continue;
    if (settings.autoCreate) {
      const parsed = parsePersonName(p.name, p.email);
      const contact = await createContactFromParticipant({
        email: p.email,
        first_name: parsed.first_name,
        last_name: parsed.last_name,
        company: guessCompanyFromEmail(p.email),
      });
      await linkEmailToContact(log.id, contact.id);
      created++;
    } else {
      const open = await findOpenPendingContact(p.email);
      if (open) continue;
      await createPendingContact({
        participant: p,
        emailLogId: log.id,
        subject: log.subject,
        from: log.from,
        receivedAt: log.received_at,
      });
      queued++;
    }
  }
  return { status: "logged", attached: matchedContactIds.length, created, queued };
}
