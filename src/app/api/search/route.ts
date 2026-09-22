import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, scanKeys } from "@/lib/db";
import type { Deal, Contact } from "@/lib/validations";
import { STAGE_LABELS, CONTACT_TYPE_LABELS } from "@/lib/constants";

function getContactDisplayName(contact: Contact): string {
  if (contact.first_name) {
    return `${contact.first_name}${contact.nickname ? ` "${contact.nickname}"` : ""} ${contact.last_name || ""}`.trim();
  }
  return (contact as unknown as Record<string, unknown>).name as string || "Unnamed";
}

type SearchResult = { type: string; id: string; title: string; subtitle: string; archived?: boolean };

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase().trim();
  if (q.length < 2) return NextResponse.json([]);

  const redis = getRedis();
  const results: SearchResult[] = [];

  // Search deals. SCAN the full deal:* keyspace rather than reading deals:active,
  // so ARCHIVED (dead/passed) deals are searchable too — they're removed from
  // deals:active (and every stage index) when killed, so an index read can never
  // reach them. deal:<id> keys are always full deal records (no sub-keys); the
  // /api/deals/inactive route relies on this same scan. Active hits rank above
  // archived ones, which are tagged so they're visually distinct in the results.
  const dealKeys = await scanKeys("deal:*");
  if (dealKeys.length > 0) {
    const pipeline = redis.pipeline();
    for (const key of dealKeys) pipeline.get(key);
    const deals = await pipeline.exec<(Deal | null)[]>();

    const activeHits: SearchResult[] = [];
    const archivedHits: SearchResult[] = [];
    for (const deal of deals) {
      if (!deal || !deal.id || !deal.address) continue;
      const searchable = `${deal.address} ${deal.city} ${deal.state} ${deal.zip || ""} ${deal.source} ${deal.property_type || ""}`.toLowerCase();
      if (!searchable.includes(q)) continue;

      const price = deal.asking_price ? `$${Math.round(deal.asking_price).toLocaleString("en-US")}` : "";
      const archived = deal.status === "dead" || deal.status === "passed";
      if (archived) {
        const statusLabel = deal.status === "dead" ? "Dead" : "Passed";
        archivedHits.push({
          type: "deal",
          id: deal.id,
          title: deal.address,
          subtitle: `Archived · ${statusLabel} — ${deal.city}, ${deal.state} — ${deal.units} units${price ? ` — ${price}` : ""}`,
          archived: true,
        });
      } else {
        activeHits.push({
          type: "deal",
          id: deal.id,
          title: deal.address,
          subtitle: `${deal.city}, ${deal.state} — ${STAGE_LABELS[deal.stage] || deal.stage} — ${deal.units} units${price ? ` — ${price}` : ""}`,
        });
      }
    }
    results.push(...activeHits, ...archivedHits);
  }

  // Search contacts
  const contactIds = await redis.zrange("contacts:all", 0, -1);
  if (contactIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of contactIds) pipeline.get(`contact:${id}`);
    const contacts = await pipeline.exec<(Contact | null)[]>();
    for (const contact of contacts) {
      if (!contact) continue;
      const name = getContactDisplayName(contact);
      const searchable = `${name} ${contact.company || ""} ${contact.email || ""} ${contact.notes || ""}`.toLowerCase();
      if (searchable.includes(q)) {
        results.push({
          type: "contact",
          id: contact.id,
          title: name,
          subtitle: `${CONTACT_TYPE_LABELS[contact.type]}${contact.company ? ` — ${contact.company}` : ""}`,
        });
      }
    }
  }

  return NextResponse.json(results.slice(0, 15));
}
