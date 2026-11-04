import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getContactEmails } from "@/lib/crm-email";

// GET /api/contacts/[id]/emails — the contact's logged correspondence, newest first.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const emails = await getContactEmails(id, 100);
    return NextResponse.json({ emails });
  } catch (err) {
    console.error("GET /api/contacts/[id]/emails error:", err);
    return NextResponse.json({ error: "Failed to load correspondence" }, { status: 500 });
  }
}
