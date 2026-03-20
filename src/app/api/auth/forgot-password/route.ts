import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import type { NextRequest } from "next/server";

function getResend() {
    return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: NextRequest) {
    try {
          const bodyOrError = await safeJson(req);
          if (isErrorResponse(bodyOrError)) return bodyOrError;
          const { email } = bodyOrError as { email?: string };
          if (!email) {
                  return NextResponse.json({ error: "Email is required" }, { status: 400 });
          }

      const { getRedis } = await import("@/lib/db");
          const redis = getRedis();

      // Rate limit: max 3 reset attempts per email per hour
      const rateLimitKey = `ratelimit:forgot:${email.toLowerCase()}`;
      const attempts = await redis.incr(rateLimitKey);
      if (attempts === 1) {
        await redis.expire(rateLimitKey, 3600); // 1 hour window
      }
      if (attempts > 3) {
        // Always return success to prevent enumeration
        return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
      }

      // Check if user exists
      const userId = await redis.get<string>(`user:email:${email}`);

      // Always return success to prevent email enumeration
      if (!userId) {
              return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
      }

      // Generate secure token
      const token = crypto.randomBytes(32).toString("hex");
          const expires = Date.now() + 3600000; // 1 hour

      // Store token in Redis with 1 hour TTL
      await redis.set(`reset:${token}`, JSON.stringify({ userId, email, expires }), { ex: 3600 });
      // Store reverse reference so we can invalidate on user deletion
      await redis.set(`user:reset_pending:${userId}`, token, { ex: 3600 });

      // Build reset URL
      const baseUrl = process.env.NEXTAUTH_URL || "https://monument-equity.vercel.app";
          const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      // Send email via Resend
      await getResend().emails.send({
              from: "Monument Equity <onboarding@resend.dev>",
              to: email,
              subject: "Reset your password — Monument Equity",
              html: `
                      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                                <h2 style="color: #1e293b;">Reset Your Password</h2>
                                <p style="color: #475569;">You requested a password reset for your Monument Equity account.</p>
                                <p style="color: #475569;">Click the button below to set a new password. This link expires in 1 hour.</p>
                                <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">Reset Password</a>
                                <p style="color: #94a3b8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                                <p style="color: #94a3b8; font-size: 12px;">Monument Equity</p>
                      </div>
              `,
      });

      return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
    } catch (error) {
          console.error("Forgot password error:", error);
          return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
}
