import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
    try {
          const bodyOrError = await safeJson(req);
          if (isErrorResponse(bodyOrError)) return bodyOrError;
          const { token, password } = bodyOrError as { token?: string; password?: string };
          if (!token || !password) {
                  return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
          }

      if (password.length < 8) {
              return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }

      const { getRedis, getEntity, setEntity } = await import("@/lib/db");
          const redis = getRedis();

      // Look up the reset token
      const tokenData = await redis.get<string | { userId: string; expires: number }>(`reset:${token}`);
          if (!tokenData) {
                  return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
          }

      const parsed = typeof tokenData === "string" ? JSON.parse(tokenData) : tokenData;
      const { userId, expires } = parsed as { userId: string; expires: number };

      if (Date.now() > expires) {
              await redis.del(`reset:${token}`);
              return NextResponse.json({ error: "Reset link has expired" }, { status: 400 });
      }

      // Hash the new password
      const password_hash = await bcrypt.hash(password, 12);

      // Update user's password in Redis
      const user = await getEntity<Record<string, unknown>>(`user:${userId}`);
          if (!user) {
                  return NextResponse.json({ error: "User not found" }, { status: 404 });
          }

      await setEntity(`user:${userId}`, { ...user, password_hash });

      // Delete the reset token so it can't be reused
      await redis.del(`reset:${token}`);
      await redis.del(`user:reset_pending:${userId}`);

      return NextResponse.json({ message: "Password reset successfully" });
    } catch (error) {
          console.error("Reset password error:", error);
          return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
}
