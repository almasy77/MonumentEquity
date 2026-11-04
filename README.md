This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`]
(https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Claude connector (MCP server)

A remote [MCP](https://modelcontextprotocol.io) server at **`https://app.monumentequity.com/api/mcp`** lets Claude (including scheduled runs) read and update the underwriting app without a browser. It acts as the signed-in user, sees only that user's deals (`user_id`), and **cannot delete anything or mark a deal dead**.

**Connect it (once):** claude.ai → Settings → Connectors → Add custom connector → URL above. Claude opens the app's sign-in page, then an *Approve* screen. After that, scheduled tasks can use the connector's tools with no stored secrets.

| Tool | Does |
|---|---|
| `list_deals`, `get_deal` | Active deals (opt. archived); full deal + its scenario ids |
| `create_deal`, `update_deal` | Create (refuses same-address duplicates); edit an allowlist of fields (no stage/status/files) |
| `pass_deal`, `reactivate_deal` | Pass with a required reason / bring back. Admin accounts only |
| `list_scenarios`, `get_scenario` | Scenarios + metrics; full assumptions + `metrics` and `annual` |
| `create_scenario`, `update_scenario` | Same engine, defaults and versioning as the UI; `update_scenario` shallow-merges each section; `other_income_items: [{label, monthly}]` gives one line per income source |
| `get_deal_activity` | Activity feed with exact timestamps and `actor` (`web` = app UI, `connector` = Claude) |

Edits made through the connector are stamped `updated_via: "connector"` / `updated_by` on the deal or scenario, and `actor: "connector"` on the activity row. `viewer` accounts are read-only; `va` accounts can edit but not pass/reactivate (same as the web API).

### How auth works

The app is its own OAuth 2.1 authorization server: dynamic client registration (`/api/oauth/register`), authorization-code + **PKCE (S256 only)** (`/oauth/authorize` → `/api/oauth/token`), rotating single-use refresh tokens, RFC 7009 revocation, and discovery at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Sign-in reuses the normal NextAuth login. Access tokens last 1 hour; refresh tokens 30 days (rotated on every use). Tokens are opaque and stored only as SHA-256 hashes in Redis, and are bound to the `/api/mcp` audience. Nothing is ever pasted into a prompt.

Clients may only redirect back to `claude.ai` / `claude.com`. To allow others (e.g. `localhost` for the MCP Inspector in development) set `MCP_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com,localhost`.

### Rotate or revoke access

- **Revoke one connection / everything:** Settings → General → **Connected apps** → *Revoke* (or *Revoke all*). Effective immediately — every call re-checks the grant. Re-add the connector in Claude to authorize again (that is also how you "rotate": revoke, then reconnect to mint a fresh grant and tokens).
- **Emergency off switch:** set `MCP_DISABLED=1` in Vercel and redeploy; `/api/mcp`, token issuance and discovery all return 503 until it is removed.
- **Invalidate everything at once:** changing the user's password does *not* revoke grants; use *Revoke all*. Removing a user account makes their tokens fail on the next call.
- A refresh token replayed more than 60 s after it was rotated is treated as theft and revokes that grant.

Optional env: `MCP_PUBLIC_URL` (public origin; defaults to `NEXTAUTH_URL`, then the request origin), `MCP_DISABLED`, `MCP_ALLOWED_REDIRECT_HOSTS`. Requires the existing `AUTH_SECRET` (signs the consent form) and Upstash Redis.

### Local testing

`npm test` covers auth (no token → 401, other user's deal → not found), the no-delete rule, the OAuth flow and every tool. To try it with the MCP Inspector: `MCP_PUBLIC_URL=http://localhost:3000 MCP_ALLOWED_REDIRECT_HOSTS=localhost npm run dev`, then `npx @modelcontextprotocol/inspector` against `http://localhost:3000/api/mcp`.
