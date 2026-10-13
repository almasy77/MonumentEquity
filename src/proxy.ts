import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/db";
import { bearerToken, isTokenActive, tokenRouteAllowed, type TokenStore } from "@/lib/api-tokens";

// API tokens: 120 requests/min per token, plus 300/min per IP for any request that
// presents an Authorization header (so random fake tokens cannot run up Redis).
let tokenLimiter: Ratelimit | null = null;
let ipLimiter: Ratelimit | null = null;
function getLimiters(): { token: Ratelimit; ip: Ratelimit } | null {
  if (tokenLimiter && ipLimiter) return { token: tokenLimiter, ip: ipLimiter };
  try {
    const redis = getRedis();
    tokenLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, "1 m"), prefix: "ratelimit:api_token" });
    ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(300, "1 m"), prefix: "ratelimit:api_token_ip" });
    return { token: tokenLimiter, ip: ipLimiter };
  } catch {
    return null; // Redis not configured (local dev without env): skip limiting
  }
}

function tooMany(reset: number) {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
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

  // Machine callers: any /api request carrying an Authorization header is judged
  // here as a token request. It never falls through to the session check, and it
  // only reaches the allowlisted handlers (which re-verify the token themselves).
  const authorization = pathname.startsWith("/api/") ? req.headers.get("authorization") : null;
  if (authorization) {
    const rawToken = bearerToken(authorization);
    if (!rawToken) return NextResponse.json({ error: "Invalid authorization header" }, { status: 401 });

    const limiters = getLimiters();
    if (limiters) {
      try {
        const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
        const byIp = await limiters.ip.limit(ip);
        if (!byIp.success) return tooMany(byIp.reset);
      } catch {
        // Limiter unavailable: fail open rather than block the API.
      }
    }

    if (!tokenRouteAllowed(pathname, req.method)) {
      return NextResponse.json({ error: "This endpoint does not accept API tokens" }, { status: 403 });
    }

    let active = false;
    try {
      active = await isTokenActive(getRedis() as unknown as TokenStore, rawToken);
    } catch {
      active = false; // cannot verify: reject
    }
    if (!active) return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });

    if (limiters) {
      try {
        const byToken = await limiters.token.limit(await tokenFingerprint(rawToken));
        if (!byToken.success) return tooMany(byToken.reset);
      } catch {
        // fail open
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
