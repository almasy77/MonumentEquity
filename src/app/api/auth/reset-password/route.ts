import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
    try {
          const { token, password } = await req.json();
          if (!token || !password) {
                  return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
          }

      if (password.length < 8) {
              return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }

      const { getRedis, getEntity, setEntity } = await import("@/lib/db");
          const redis = getRedis();

      // Look up the reset token
      const tokenData = await redis.get<string>(`reset:${token}`);
          if (!tokenData) {
                  return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
          }

      const { userId, expires } = typeof tokenData === "string" ? JSON.parse(tokenData) : tokenData;

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

      return NextResponse.json({ message: "Password reset successfully" });
    } catch (error) {
          console.error("Reset password error:", error);
          return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
}
