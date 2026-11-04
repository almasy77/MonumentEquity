import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listGrants, revokeAllGrants, revokeGrant } from "@/lib/mcp/oauth-store";

// Connected-apps management for the signed-in user (Settings → General → Connected apps).
// Session-authenticated only; a connector token cannot list or revoke grants.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const grants = await listGrants(session.user.id);
  return NextResponse.json(
    grants.map((g) => ({
      id: g.id,
      client_name: g.client_name,
      created_at: g.created_at,
      last_used_at: g.last_used_at ?? null,
    }))
  );
}

// DELETE /api/oauth/grants?id=<grant>   revoke one
// DELETE /api/oauth/grants?all=1        revoke every connector authorization for this user
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = req.nextUrl.searchParams;
  if (params.get("all") === "1") {
    return NextResponse.json({ revoked: await revokeAllGrants(session.user.id) });
  }
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id or all=1 required" }, { status: 400 });
  const ok = await revokeGrant(session.user.id, id);
  return ok ? NextResponse.json({ revoked: 1 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
