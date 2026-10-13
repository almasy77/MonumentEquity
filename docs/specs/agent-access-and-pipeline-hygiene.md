# Spec: Agent Access and Pipeline Hygiene

Status: Draft for implementation · Owner: Bryan Frank · Written 2026-10-13

Three changes that let Claude agents (Scout, Underwriter, Broker desk) work against the app safely and unattended, and stop the pipeline from accumulating junk. Ship as three separate PRs, in the order below. Each PR must pass `npx tsc --noEmit`, `npm run lint` and `npm test` per CLAUDE.md.

## Why

| Problem today | Evidence | Fix |
|---|---|---|
| Agents can only reach the API through Bryan's logged-in Chrome session | All 50 API routes gate on `await auth()` (NextAuth session cookie). No token path exists. Session expires 2026-11-10. | PR 1: scoped API tokens |
| Same property gets logged twice | Archived list holds at least 4 duplicate pairs: 4443 Mobile Drive (x2), 1514 Northwest Dr NW / 1514 Northwest Drive NW, 641 Powder Springs St / 641 Powder Springs Street, 107 Hilton Ave / 107-109 Hilton Ave. `POST /api/deals` has no duplicate check; only `import-om` does, and only against active deals with a substring match. | PR 2: duplicate guard on every create path |
| Kill reasons carry no information | `deal-status-actions.tsx` hardcodes `kill_reason: "Marked dead"` and `pass_reason: "Passed on deal"`. About 50 of 74 archived deals carry only those strings. Some records show status Passed with reason "Marked dead". | PR 3: required reason category plus text |

## PR 1: Scoped API tokens

### Behavior

- A request with `Authorization: Bearer me_<token>` is authenticated as a **token principal** instead of a session user.
- The token principal always has role `va`. That reuses the existing VA restrictions: no stage or status changes, no deletes, no settings, no export, no share links. Agents can create deals (stage `lead` only), create and edit scenarios, edit deal fields and notes, and read everything.
- Requests with neither a valid session nor a valid token get the same 401 as today.

### Storage

- Key: `api_token:<sha256 of raw token>` → JSON `{ id, name, user_id, role: "va", created_at, last_used_at, revoked_at? }`.
- Index: `api_tokens` (sorted set of token record ids) for listing.
- Never store the raw token. Show it once at creation.
- **Do not** put anything under the `deal:` prefix (see PR #180: any non-record key under `deal:` breaks the `deal:*` scans).

### Code changes

1. `src/lib/auth-actor.ts` (new): `getActor(req): Promise<{ id: string; role: "admin" | "va" | "viewer"; via: "session" | "token"; tokenName?: string } | null>`. It checks the bearer header first (hash, lookup, reject if revoked, update `last_used_at` at most once per minute), then falls back to `auth()`.
2. Replace `const session = await auth()` with `getActor(req)` in the routes agents need. **Phase 1 list only**: `deals` (GET, POST), `deals/[id]` (GET, PUT), `deals/inactive`, `scenarios` (GET, POST), `scenarios/[id]` (GET, PUT), `contacts` (GET, POST), `contacts/[id]` (GET, PUT), `tasks` (GET, POST), `activities`, `search`, `leads/count`. Leave every other route session-only.
3. `src/proxy.ts`: for paths under `/api/` that carry an `Authorization: Bearer me_` header, pass through to the route (the route does the real check). Do not redirect them to `/login`.
4. `logActivity` callers: when the actor is a token, set `user_id` to the token's owning user and add `details.via = "token:<name>"` so agent writes are visible in the activity log.
5. `POST /api/deals`: when the actor's role is `va`, ignore `body.stage` and always create at `lead`. Today the route accepts any stage from the body, so a VA (and therefore a token) could create a deal directly at `loi`; the VA rule against changing stages only applies to PUT.
6. Rate limit token requests with the already-installed `@upstash/ratelimit`: 120 requests per minute per token; return 429 with `Retry-After`.
7. Admin UI in `/settings`: list tokens (name, created, last used, status), create (returns raw token once), revoke. Admin only.
8. `scripts/create-api-token.ts`: same create path from the CLI, for bootstrapping.

### Acceptance

- [ ] `curl -H "Authorization: Bearer me_…" /api/deals` returns the active deal list.
- [ ] Same token: `PUT /api/deals/<id>` with `{ "status": "passed" }` returns 403 (VA rule). `{ "market_notes": "x" }` returns 200.
- [ ] Same token: `DELETE /api/deals/<id>` returns 403.
- [ ] Same token: `POST /api/deals` with `"stage": "loi"` creates the deal at `lead`.
- [ ] A revoked token returns 401 within one request.
- [ ] Session login behavior is unchanged (all existing tests pass).
- [ ] Activity entries written by a token show `via: token:<name>`.
- [ ] Unit tests: token hashing and lookup, revoked token, missing header falls back to session, role is always `va`.

## PR 2: Duplicate guard on deal creation

### Behavior

- Every create path checks for an existing deal at the same address, **active or archived**, before writing: `POST /api/deals`, `POST /api/leads/[id]/approve`, `POST /api/deals/bulk-import`, `POST /api/deals/import-url`, `POST /api/deals/import-om` (replace its current `findDuplicates`).
- On a match, return `409 { error: "duplicate", matches: [{ id, address, city, state, units, status, stage }] }`.
- The caller can override with `force: true` in the body (UI: "Create anyway" button on the duplicate warning). Bulk import reports duplicates per row and skips them unless `force` is set for the batch.

### Matching

`normalizeAddress(address, city, state, zip)` in `src/lib/address-normalize.ts`:

- Lowercase, strip punctuation, collapse whitespace.
- Drop parenthetical text: "200-210 Electric Ave (Jody Apartments)" becomes "200-210 electric ave".
- Standardize suffixes and directionals: street→st, drive→dr, avenue→ave, road→rd, boulevard→blvd, court→ct, lane→ln, place→pl, north→n, south→s, east→e, west→w, northwest→nw (and the other three).
- Ranges: "107-109 hilton ave" yields keys for both "107 hilton ave" and "109 hilton ave", plus the full range. Two deals match if any key overlaps.
- Key = normalized street + `|` + (zip if present, else city + state, lowercased).

Index: `dealaddr:<key>` → Redis SET of deal ids (again, **not** under `deal:`). Maintain it on create, on address edit (PUT), and on delete. One-time backfill via `scripts/backfill-address-index.ts`.

### Acceptance

- [ ] Unit tests with the four known pairs above: each pair produces an overlapping key.
- [ ] Negative tests: "1514 Northwest Dr NW" vs "1514 Northwest Dr NE" do not match; same street in different zip codes does not match.
- [ ] `POST /api/deals` for an archived address returns 409 listing the archived deal.
- [ ] `force: true` creates the deal and logs `details.duplicate_override = true`.
- [ ] Backfill script prints the existing duplicate groups (expect at least the 4 pairs) without changing or merging anything.

## PR 3: Required kill reasons

### Behavior

- Marking a deal Dead or Passed opens a dialog instead of writing immediately.
  - **Category** (required), from a fixed list: `price`, `size_out_of_box`, `market`, `asset_type`, `hurdles_not_met`, `financials_missing`, `seller_or_timing`, `sold_or_expired`, `duplicate`, `other`.
  - **Reason** (required, at least 15 characters), with a placeholder showing the house format: "what failed, the number, and the re-engage price if any".
- API: `PUT /api/deals/[id]` with `status` of `dead` or `passed` requires `kill_category` and a reason of 15+ characters, else 400. Store the reason in `kill_reason` for dead and `pass_reason` for passed (unchanged fields), plus the new optional `kill_category`.
- Archived list shows the category as a chip and allows filtering by it.

### Schema

- `dealSchema`: add `kill_category: z.enum([...]).optional()`. Optional for backward compatibility; existing records simply lack it.

### Backfill

- `scripts/backfill-kill-category.ts`: for archived deals whose reason starts with `Triage 10/11/26:`, infer the category from the text (price cap → `price`, unit count → `size_out_of_box`, hurdles → `hurdles_not_met`, auction or sold → `sold_or_expired`, institutional or not multifamily → `asset_type`). For reasons equal to "Marked dead" or "Passed on deal", set `kill_category: "other"` and leave the text. Dry-run by default; print the proposed changes.

### Acceptance

- [ ] UI: Mark Dead and Pass both open the dialog; Save stays disabled until both fields are valid.
- [ ] API: missing category or a short reason returns 400; existing reactivation (`status: "active"`) needs neither.
- [ ] Archived list shows the category chip and filters by it.
- [ ] Backfill dry run lists the 16 triage deals with inferred categories and about 50 generic ones as `other`.

## Out of scope

- Agent scheduling and the agents themselves (built as Claude skills, outside the app).
- Activity log pagination (currently capped at 20 per deal).
- Merging duplicate records. PR 2 only detects and reports them.
- Making the GitHub repository private (a separate decision for Bryan).

## Notes for the implementer

- Production deploys from `main`. On 2026-10-12 Vercel did not auto-deploy a merge to `main`; after merging, confirm a production deployment exists for the merge commit.
- Underwriting engine files (`underwriting.ts`, `irr.ts`) are not touched by any of these PRs.
