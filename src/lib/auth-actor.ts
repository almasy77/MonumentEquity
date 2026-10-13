import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { bearerToken, resolveApiToken, TOKEN_ROLE, type TokenStore } from "@/lib/api-tokens";

/**
 * The caller behind an API request: a logged-in user (session cookie) or an API
 * token. Shaped like a NextAuth session (`actor.user.id`, `actor.user.role`) so
 * routes can swap `await auth()` for `await getActor()` without other changes.
 *
 * Token principals always carry role "va" and are attributed to the admin who
 * created the token. Only routes that explicitly call getActor() accept tokens;
 * every other route stays session-only.
 */
export interface Actor {
  user: { id: string; role: "admin" | "va" | "viewer"; email: string; name: string };
  via: "session" | "token";
  tokenId?: string;
  tokenName?: string;
}

export async function getActor(): Promise<Actor | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization) {
    // Any Authorization header means "authenticate me with this", so it must be a
    // valid token. Never fall back to the session cookie: a malformed, truncated
    // or revoked token must not ride on a browser login.
    const raw = bearerToken(authorization);
    if (!raw) return null;
    const redis = getRedis();
    const rec = await resolveApiToken(redis as unknown as TokenStore, raw);
    if (!rec) return null;
    // The token acts on behalf of the admin who created it; if that user was
    // removed or demoted, the token dies with them.
    const owner = await redis.get<{ role?: string }>(`user:${rec.user_id}`);
    if (owner?.role !== "admin") return null;
    return {
      user: { id: rec.user_id, role: TOKEN_ROLE, email: "", name: `token:${rec.name}` },
      via: "token",
      tokenId: rec.id,
      tokenName: rec.name,
    };
  }
  const session = await auth();
  if (!session?.user) return null;
  return {
    user: {
      id: session.user.id,
      role: session.user.role,
      email: session.user.email ?? "",
      name: session.user.name ?? "",
    },
    via: "session",
  };
}

/** Extra activity-log details marking a write made through an API token. */
export function actorDetails(actor: Actor): Record<string, string> {
  return actor.via === "token" ? { via: `token:${actor.tokenName}` } : {};
}
