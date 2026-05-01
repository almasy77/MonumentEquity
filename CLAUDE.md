# Monument Equity — Real Estate Underwriting PWA

## Quick Start

```bash
npm install
npm run dev          # Start dev server on http://localhost:3000
npm run build        # Production build (also runs ESLint)
npm run lint         # ESLint only
npx tsc --noEmit     # TypeScript type-check only
```

## Required Environment Variables

Copy `.env.example` to `.env.local` and fill in:

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis (primary data store)
- `NEXTAUTH_SECRET` / `AUTH_SECRET` — NextAuth session signing
- `ANTHROPIC_API_KEY` — Claude API for AI-powered URL extraction
- `POSTMARK_WEBHOOK_SECRET` — Inbound email webhook (optional)

## Tech Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Language:** TypeScript (strict mode)
- **Database:** Upstash Redis (REST API) — no SQL/ORM
- **Auth:** NextAuth.js v5 (beta) with Credentials provider, JWT sessions
- **UI:** shadcn/ui + Tailwind CSS + Lucide icons
- **Other:** ExcelJS (exports), Recharts (charts), Resend (email), Zod (validation)

## Project Structure

```
src/
├── app/
│   ├── (authenticated)/     # Protected routes (dashboard, deals, contacts, etc.)
│   ├── api/                 # API routes (auth, deals, contacts, tasks, export)
│   ├── login/               # Login page
│   ├── forgot-password/     # Password reset flow
│   ├── reset-password/
│   └── share/               # Public deal share links
├── components/              # React components (ui/, deal/, layout/, etc.)
├── lib/                     # Core logic
│   ├── db.ts                # Redis client + typed CRUD helpers
│   ├── auth.ts              # NextAuth config
│   ├── underwriting.ts      # Financial calculation engine
│   ├── validations.ts       # Zod schemas
│   ├── excel-export.ts      # Excel report generation
│   ├── ai-extract.ts        # Claude API integration
│   ├── irr.ts               # IRR calculation
│   ├── activity.ts          # Activity logging
│   └── constants.ts         # App constants
└── proxy.ts                 # Route protection proxy (auth gate)
```

## Code Conventions

- **No tests** — project has no test suite. Validate changes with `npm run build` and `npx tsc --noEmit`.
- **ESLint** must pass with zero errors and zero warnings before committing.
- **Imports** use `@/` path alias (mapped to `src/`).
- **Data layer** is Redis key-value: entities stored as JSON with keys like `deal:${id}`, `user:email:${email}`. See `src/lib/db.ts` for the pattern.
- **Auth roles:** `admin` and `va` (Virtual Assistant). Role checks in `src/lib/role-check.ts`.
- **Financial calcs** live in `src/lib/underwriting.ts` — changes here affect all deal analysis outputs.
- **Components** follow shadcn/ui patterns. UI primitives in `src/components/ui/`, feature components in `src/components/deal/`, etc.

## Deploying to Production

Production deploys automatically when code is merged to `main`. To push changes to production:

1. **Validate before merging** — every change must pass all three checks:
   ```bash
   npx tsc --noEmit       # TypeScript — zero errors
   npm run lint            # ESLint — zero errors, zero warnings
   npm run build           # Full production build — must succeed
   ```
2. **Create a PR** from your feature branch to `main`:
   ```bash
   git push -u origin <your-branch>
   gh pr create --base main --title "Brief description" --body "Summary of changes"
   ```
3. **Merge the PR** — this triggers the production deploy:
   ```bash
   gh pr merge <pr-number> --squash --delete-branch
   ```
4. **Verify** — confirm the deploy succeeded in your hosting dashboard (Vercel/etc.).

### Rules

- **Never push directly to `main`** — always go through a PR.
- **Never merge with failing checks** — all three validation commands above must pass.
- **Squash merge** — keep `main` history clean with one commit per feature/fix.
- **Delete the feature branch** after merge to avoid stale branches.
- **Financial engine changes** (`src/lib/underwriting.ts`, `src/lib/irr.ts`) require extra scrutiny — trace through example calculations before merging.
- **Schema changes** must be backwards-compatible (new fields must be optional with sensible defaults) since there is no migration system.

## Important Notes

- The app uses **Upstash Redis** (not a SQL database). All data access goes through `src/lib/db.ts`.
- **No migration system** — schema changes are backwards-compatible JSON shape changes.
- Security headers are set in `next.config.ts` (X-Frame-Options DENY, nosniff, etc.).
- The `share/` route is publicly accessible (no auth required) — be careful with data exposure.

