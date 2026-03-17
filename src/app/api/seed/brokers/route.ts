import { NextResponse } from "next/server";
import { getRedis, addToIndex } from "@/lib/db";

// POST /api/seed/brokers — seed Durham broker contacts from the workbook
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed disabled in production" }, { status: 403 });
  }
  const redis = getRedis();

  const brokers = [
    {
      name: "Jeff Glenn",
      company: "Northmarq",
      type: "broker" as const,
      email: "",
      phone: "",
      notes: "Durham multifamily specialist. Coverage: Triangle & Triad. From Durham First-Deal Workbook broker tracker.",
    },
    {
      name: "Steven Peden",
      company: "Avison Young",
      type: "broker" as const,
      email: "",
      phone: "",
      notes: "Durham multifamily broker. Coverage: Triangle market. From Durham First-Deal Workbook broker tracker.",
    },
    {
      name: "Matt Robertson",
      company: "Berkadia",
      type: "broker" as const,
      email: "",
      phone: "",
      notes: "Durham multifamily broker. Coverage: Carolinas. From Durham First-Deal Workbook broker tracker.",
    },
    {
      name: "John Daly",
      company: "Marcus & Millichap",
      type: "broker" as const,
      email: "",
      phone: "",
      notes: "Durham multifamily broker. Coverage: Triangle & Eastern NC. From Durham First-Deal Workbook broker tracker.",
    },
  ];

  const created: string[] = [];
  const now = new Date().toISOString();

  for (const broker of brokers) {
    // Check if a contact with same name+company already exists by scanning index
    const existingIds = await redis.zrange("contacts:by_type:broker", 0, -1);
    let exists = false;
    if (existingIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of existingIds) {
        pipeline.get(`contact:${id}`);
      }
      const results = await pipeline.exec<(Record<string, unknown> | null)[]>();
      exists = results.some(
        (r) => r && r.name === broker.name && r.company === broker.company
      );
    }

    if (exists) continue;

    const id = crypto.randomUUID();
    const contact = {
      id,
      ...broker,
      deal_ids: [],
      created_at: now,
      updated_at: now,
    };

    await redis.set(`contact:${id}`, JSON.stringify(contact));
    await addToIndex("contacts:by_type:broker", id, Date.now());
    await addToIndex("contacts:all", id, Date.now());
    created.push(broker.name);
  }

  return NextResponse.json({
    message: `Seeded ${created.length} broker contacts`,
    created,
  }, { status: 201 });
}
