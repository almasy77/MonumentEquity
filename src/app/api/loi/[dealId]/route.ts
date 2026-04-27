import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { generateLOI } from "@/lib/loi-generator";
import type { PurchaseAssumptions } from "@/lib/underwriting";
import type { Deal, Scenario, Contact } from "@/lib/validations";

type RouteContext = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can generate LOIs" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const scenarioId = req.nextUrl.searchParams.get("scenario_id");

  if (!scenarioId) {
    return NextResponse.json({ error: "scenario_id is required" }, { status: 400 });
  }

  const redis = getRedis();

  const [deal, scenario] = await Promise.all([
    redis.get<Deal>(`deal:${dealId}`),
    redis.get<Scenario>(`scenario:${scenarioId}`),
  ]);

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  if (scenario.deal_id !== dealId) {
    return NextResponse.json({ error: "Scenario does not belong to this deal" }, { status: 400 });
  }

  const purchase = scenario.purchase_assumptions as unknown as PurchaseAssumptions;

  let contacts: Contact[] = [];
  if (deal.contact_ids && deal.contact_ids.length > 0) {
    const pipeline = redis.pipeline();
    for (const cId of deal.contact_ids) {
      pipeline.get(`contact:${cId}`);
    }
    const results = await pipeline.exec<(Contact | null)[]>();
    contacts = results.filter((c): c is Contact => c !== null);
  }

  const buffer = await generateLOI({ deal, purchase, contacts });

  const safeName = deal.address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
  const date = new Date().toISOString().split("T")[0];
  const filename = `LOI_${safeName}_${date}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
