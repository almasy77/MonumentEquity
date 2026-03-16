import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Deal, Contact } from "@/lib/validations";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCSV(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCSV).join(",");
  const dataLines = rows.map((row) => row.map(escapeCSV).join(","));
  return [headerLine, ...dataLines].join("\n");
}

async function exportDeals(): Promise<string> {
  const redis = getRedis();
  const ids = await redis.zrange("deals:active", 0, -1, { rev: true });
  if (ids.length === 0) return toCSV(["address"], []);

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`deal:${id}`);
  }
  const results = await pipeline.exec<(Deal | null)[]>();
  const deals = results.filter((r): r is Deal => r !== null);

  const headers = [
    "address",
    "city",
    "state",
    "zip",
    "units",
    "year_built",
    "asking_price",
    "bid_price",
    "stage",
    "status",
    "source",
    "current_noi",
    "current_occupancy",
    "created_at",
  ];

  const rows = deals.map((d) => [
    d.address || "",
    d.city || "",
    d.state || "",
    d.zip || "",
    String(d.units ?? ""),
    String(d.year_built ?? ""),
    String(d.asking_price ?? ""),
    String(d.bid_price ?? ""),
    d.stage || "",
    d.status || "",
    d.source || "",
    String(d.current_noi ?? ""),
    String(d.current_occupancy ?? ""),
    d.created_at || "",
  ]);

  return toCSV(headers, rows);
}

async function exportContacts(): Promise<string> {
  const redis = getRedis();
  const ids = await redis.zrange("contacts:all", 0, -1, { rev: true });
  if (ids.length === 0) return toCSV(["first_name"], []);

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`contact:${id}`);
  }
  const results = await pipeline.exec<(Contact | null)[]>();
  const contacts = results.filter((r): r is Contact => r !== null);

  const headers = [
    "first_name",
    "last_name",
    "company",
    "title",
    "type",
    "tags",
    "email",
    "phone",
    "website",
    "linkedin_url",
    "deal_count",
    "created_at",
  ];

  const rows = contacts.map((c) => [
    c.first_name || "",
    c.last_name || "",
    c.company || "",
    c.title || "",
    c.type || "",
    (c.tags || []).join(";"),
    c.email || "",
    c.phones?.length ? c.phones[0].number : c.phone || "",
    c.website || "",
    c.linkedin_url || "",
    String(c.deal_ids?.length ?? 0),
    c.created_at || "",
  ]);

  return toCSV(headers, rows);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (type !== "deals" && type !== "contacts") {
    return NextResponse.json(
      { error: "Invalid type. Use ?type=deals or ?type=contacts" },
      { status: 400 }
    );
  }

  try {
    const csv = type === "deals" ? await exportDeals() : await exportContacts();
    const filename = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("CSV export error:", error);
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    );
  }
}
