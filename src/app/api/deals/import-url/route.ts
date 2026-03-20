import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { extractDealFromUrl } from "@/lib/ai-extract";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;
    const { url } = body as { url?: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const extracted = await extractDealFromUrl(url);

    const fieldCount = Object.keys(extracted).length;
    if (fieldCount === 0) {
      return NextResponse.json(
        { error: "Could not extract any listing data from this URL. Try pasting the listing details manually." },
        { status: 422 }
      );
    }

    return NextResponse.json(extracted);
  } catch (err) {
    console.error("URL import error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to extract listing data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
