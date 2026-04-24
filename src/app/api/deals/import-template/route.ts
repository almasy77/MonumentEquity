import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTemplate } from "@/lib/import-parser";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buffer = await generateTemplate();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="monument-equity-import-template.xlsx"',
    },
  });
}
