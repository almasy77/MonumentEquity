import { NextResponse } from "next/server";
import { extractDealFromUrl } from "@/lib/ai-extract";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "AI extraction is not configured. Please set ANTHROPIC_API_KEY." },
        { status: 503 }
      );
    }

    const extracted = await extractDealFromUrl(url);

    return NextResponse.json(extracted);
  } catch (err) {
    console.error("URL import error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to extract listing data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
