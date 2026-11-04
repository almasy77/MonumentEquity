import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
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
    // MCP connector (Claude). These do their OWN auth and must not be redirected to
    // /login: /api/mcp validates a Bearer token and answers 401 + WWW-Authenticate;
    // the OAuth metadata/register/token/revoke endpoints are public by protocol; and
    // /oauth/authorize is the consent page, which sends an unauthenticated visitor to
    // /login itself so the full authorize query string survives the round trip.
    // (/api/oauth/authorize and /api/oauth/grants stay behind the session gate.)
    pathname.startsWith("/.well-known/") ||
    pathname === "/api/mcp" ||
    pathname === "/api/oauth/register" ||
    pathname === "/api/oauth/token" ||
    pathname === "/api/oauth/revoke" ||
    pathname === "/oauth/authorize" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    // App-router generated icons (src/app/{icon.svg,apple-icon.png}). Without these
    // the browser's preferred SVG favicon and the iOS touch icon 307-redirect to
    // /login for unauthenticated requests and never render.
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.png" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js"
  ) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icons/).*)"],
};
