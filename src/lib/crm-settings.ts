import { getRedis } from "@/lib/db";

/**
 * Settings for the CRM email-logging flow (BCC an email → attach to a contact).
 *
 * Resolution order (later wins): hardcoded defaults → environment → the Redis
 * `settings:crm-email` document (so it can be edited at runtime later). Everything
 * is normalized to lowercase for comparison.
 */
export interface CrmEmailSettings {
  /** Internal staff addresses — never treated as a contact. */
  staffEmails: string[];
  /** Internal domains — any address at these is staff (e.g. "monumentequity.com"). */
  staffDomains: string[];
  /** The CRM inbound/BCC address itself — always excluded from contact matching. */
  inboundAddress?: string;
  /** When true, unmatched external parties become contacts immediately (no review). */
  autoCreate: boolean;
}

// Seeded from the account owner's known addresses. Editable via env or Redis.
const DEFAULT_STAFF_EMAILS = ["bfrank@monumentequity.com", "bryan.j.frank@gmail.com"];

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

interface StoredCrmSettings {
  staff_emails?: string[];
  staff_domains?: string[];
  inbound_address?: string;
  auto_create?: boolean;
}

/** Resolve the effective CRM email settings. */
export async function getCrmEmailSettings(): Promise<CrmEmailSettings> {
  let stored: StoredCrmSettings | null = null;
  try {
    stored = await getRedis().get<StoredCrmSettings>("settings:crm-email");
  } catch {
    // Redis unavailable at read time — fall back to env + defaults.
  }

  const envEmails = splitList(process.env.MONUMENT_STAFF_EMAILS);
  const envDomains = splitList(process.env.MONUMENT_STAFF_DOMAINS);

  const staffEmails = dedupeLower([
    ...DEFAULT_STAFF_EMAILS,
    ...envEmails,
    ...(stored?.staff_emails ?? []),
  ]);
  const staffDomains = dedupeLower([
    ...envDomains,
    ...(stored?.staff_domains ?? []),
  ]);
  const inboundAddress = (
    stored?.inbound_address ??
    process.env.CRM_INBOUND_ADDRESS ??
    ""
  )
    .trim()
    .toLowerCase() || undefined;

  const autoCreate =
    stored?.auto_create ??
    /^(1|true|yes)$/i.test(process.env.CRM_AUTO_CREATE_CONTACTS ?? "");

  return { staffEmails, staffDomains, inboundAddress, autoCreate };
}

function dedupeLower(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean)));
}

/**
 * True when an address is "us" (staff or the inbound address itself) and so must
 * never be matched to or created as a contact.
 */
export function isInternalAddress(email: string, settings: CrmEmailSettings): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return true; // empty/garbage is never a contact
  if (settings.inboundAddress && e === settings.inboundAddress) return true;
  if (settings.staffEmails.includes(e)) return true;
  const domain = e.split("@")[1];
  if (domain && settings.staffDomains.includes(domain)) return true;
  return false;
}
