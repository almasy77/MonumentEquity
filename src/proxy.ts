import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/db";
import { bearerToken } from "@/lib/api-tokens";

// API tokens: 120 requests per minute per token (sliding window).
let tokenLimiter: Ratelimit | null = null;
function getTokenLimiter(): Ratelimit | null {
  if (tokenLimiter) return tokenLimiter;
  try {
    tokenLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "ratelimit:api_token",
    });
  } catch {
    tokenLimiter = null; // Redis not configured (local dev without env): skip limiting
  }
  return tokenLimiter;
}

async function tokenFingerprint(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/seed") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js"
  ) {
    return NextResponse.next();
  }

  // API token requests: rate-limit here, then let the route authenticate the
  // token (routes that do not call getActor() still return 401). Never redirect
  // a machine caller to the login page.
  const rawToken = pathname.startsWith("/api/") ? bearerToken(req.headers.get("authorization")) : null;
  if (rawToken) {
    const limiter = getTokenLimiter();
    if (limiter) {
      try {
        const { success, reset } = await limiter.limit(await tokenFingerprint(rawToken));
        if (!success) {
          const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
          return NextResponse.json(
            { error: "Rate limit exceeded" },
            { status: 429, headers: { "Retry-After": String(retryAfter) } }
          );
        }
      } catch {
        // Limiter unavailable: fail open rather than block the API.
      }
    }
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
