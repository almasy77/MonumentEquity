# Monument Equity — Product Specification

**Version:** 0.1.1
**Last Updated:** March 2026
**Tech Stack:** Next.js 16 (React 19, Turbopack) · Upstash Redis · NextAuth · Tailwind CSS · Vercel

---

## 1. Product Overview

Monument Equity is a real estate deal management and underwriting platform designed for small multifamily acquisition teams. It covers the full deal lifecycle: sourcing, screening, financial analysis, scenario modeling, due diligence tracking, and closing.

**Target Users:**
- Real estate acquisition teams (1-5 people)
- Value-add multifamily investors
- Operators running a deal pipeline of 10-50+ deals

**Core Value Proposition:**
One system for pipeline management, financial underwriting, and deal tracking — replacing spreadsheets, shared drives, and disconnected tools.

---

## 2. Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| State | Server Components + Client Components, React Query |
| Auth | NextAuth v5 (credentials provider), bcrypt, JWT sessions |
| Database | Upstash Redis (serverless, sorted sets for indexing) |
| Calculations | Pure TypeScript underwriting engine (server-side) |
| Drag & Drop | @dnd-kit |
| Charts | Recharts |
| Export | ExcelJS (XLSX), server-rendered HTML (PDF) |
| Email | Resend |
| Deployment | Vercel |
| Validation | Zod |

---

## 3. User Roles & Access

| Capability | Admin | VA (Virtual Assistant) |
|---|---|---|
| View dashboard & pipeline | Yes | Yes |
| Add deals | Yes | Yes |
| Edit deal fields | Yes | Yes |
| Change deal stage | Yes | No |
| Mark deal dead/pass | Yes | No |
| Share deals | Yes | No |
| Export (XLSX/PDF/CSV) | Yes | No |
| Manage scenarios | Yes | Yes |
| Add tasks/contacts | Yes | Yes |
| Access settings | Yes | No |
| Change password | Yes | No |

---

## 4. Pages & Features

### 4.1 Dashboard (`/`)

**Purpose:** At-a-glance portfolio health.

| Widget | Data | Source |
|---|---|---|
| Active Deals count | Count of deals with status=active | `deals:active` index |
| Pipeline Value | Sum of asking_price across active deals | Calculated server-side |
| Overdue Tasks | Tasks where due_date < today & not completed | `tasks:all` index |
| Stale Deals | Deals exceeding stage-specific stale thresholds | Stage config × days in stage |
| Pipeline Summary | Bar chart: deal count and value by stage | Grouped from active deals |
| Needs Attention | Priority-sorted alerts (overdue tasks, DD expiring, closing soon, stale) | Multi-source aggregation |
| Recent Activity | Last 10 activity entries across all deals | `activities:recent` index |

### 4.2 Pipeline / Kanban (`/pipeline`)

**Purpose:** Visual deal flow management.

**Stages (columns):**
Lead → Screening → Analysis → LOI → Under Contract → Due Diligence → Closing → Closing Docs

**Deal Card Fields:**
- Address, City/State
- Units, Asking Price, Price/Unit
- Source badge, Days in pipeline

**Actions:**
- Drag & drop between stages (updates deal.stage via PUT)
- Click card → deal detail page
- Add Deal dialog (manual entry or URL import)
- Export CSV (all deals)
- Compare Deals (select up to 4 side-by-side)

### 4.3 Deal Detail (`/deals/[id]`)

**Purpose:** Single deal hub — all property facts, process tracking, and quick KPIs.

**Sections (top to bottom):**

1. **Header** — Property address (Google Maps linked), Underwrite button, Share (admin), Stage selector (admin), Status actions (admin)

2. **KPI Bar** — 8 metrics from selected scenario (IRR, Cash-on-Cash, DSCR, Equity Multiple, Going-In Cap, Total Equity, NOI Yr 1, Net Proceeds). **Dropdown selector** to switch between scenarios.

3. **Property Details** (collapsible) — Asking Price, Units, Price/Unit, Days in Pipeline, Address, City, State, Zip, Source, Year Built, Property Type, Square Footage, Lot Size, Listing URL, Notes, Building Details (Construction, Roof, HVAC, Laundry, Electrical, Plumbing, Parking, Foundation). All fields inline-editable.

4. **Seller/Broker Financials** (collapsible) — Current NOI, Occupancy %, Annual Taxes, Annual Insurance, Tax Records URL. All editable.

5. **Due Diligence & Closing** (collapsible) — DD Start/End Dates, Closing Date, Final Purchase Price. All editable.

6. **Comps** (tabbed) — Market Sales comps, Rent Comps, Crexi Search. Filtered by deal city. Add comp buttons.

7. **Contacts / Neighborhood / Activity** (3-column) — Assigned contacts with add/search, Neighborhood resource links, Recent activity feed.

8. **Buy Box Scorecard** (conditional: Lead/Screening/Analysis stages) — Qualitative factors (8 weighted), Neighborhood factors (6 weighted), Hard gates (units, rehab/unit, DSCR, yield, neighborhood), Final score + recommendation (PURSUE/MAYBE/PASS).

9. **Tasks & Checklists** (2-column) — Task list with add button, Stage-appropriate checklists.

### 4.4 Underwriting (`/deals/[id]/underwrite`)

**Purpose:** Full financial modeling with scenario comparison.

**Scenario Management:**
- Scenario tabs (Base Case, Upside, Downside, Value-Add, Sale Analysis, Custom)
- Context menu per scenario: Rename, Clone, Archive, Delete
- Create new scenario button
- Show/hide archived scenarios
- Export Excel button

**Per-Scenario Content:**

| Section | Fields |
|---|---|
| **Purchase & Financing** | Purchase Price, Closing Costs %, Earnest Money, LTV, Interest Rate, Amortization (yrs), Loan Term (yrs), IO Period (mo), Origination Fee % |
| **Bid & LOI** | Bid Price, LOI Amount, LOI Date, Earnest Money |
| **Revenue & Rent Roll** | Unit Mix table (Type, Count, Current Rent, Market Rent, Reno Premium), Other Income, Vacancy %, Bad Debt %, Rent Growth %/yr |
| **T12 Operating Statement** | Read-only annual totals from deal T12, "Import to Expenses" button |
| **Operating Expenses** | Mgmt Fee % EGI, Payroll, R&M/unit, Turnover/unit, Insurance/unit, Property Tax total, Tax Escalation %, Utilities/unit, Admin/Legal/Mktg, Contract Services, Reserves/unit |
| **CapEx: Per-Unit Renovations** | Cost/Unit, Units to Renovate, Units/Month |
| **CapEx: Named Projects** | Project Name, Cost, Start Month, Duration (mo) |
| **Exit / Refi / Sale** | Hold Period (yrs), Exit Cap Rate %, Selling Costs % |

**Outputs:**
- **Metrics Bar** — IRR, Cash-on-Cash, DSCR, Equity Multiple, Going-In Cap, Stabilized Cap, Total Equity, Net Proceeds
- **Pro Forma Table** — Annual view (10 years) or Monthly view (12 months with year selector). Line items: GPR, Vacancy Loss, Bad Debt, Concessions, Other Income, EGI, OpEx, NOI, Debt Service, CapEx, Cash Flow, Cash-on-Cash
- **Sensitivity Grid** — 5×5 matrix: Purchase Price delta (-10% to +10%) × Exit Cap Rate adjustment (-1% to +1%), IRR in each cell

**Calculation Engine:**
- Monthly granularity over configurable hold period
- Renovation schedule tracking (cumulative units renovated per month)
- Rent growth compounded annually on both unrenovated and renovated units
- IO period → amortizing debt service transition
- IRR via Newton's method from equity cash flows
- Sensitivity grid recalculated per scenario

### 4.5 Contacts (`/contacts`)

- Filter by type (Broker, Lender, Attorney, Advisor, Other)
- Search (name, company, email, notes, tags)
- Sort (Name, Company, Type, Date)
- Add/Edit contact dialog
- Contact fields: Name, Email, Phone(s), Type, Company, Tags, Notes

### 4.6 Comps (`/comps`)

- Two tabs: Market Sales, Rent Comps
- Add Market Comp (Address, City, State, Zip, Sale Date, Units, Sale Price, Cap Rate, Notes)
- Add Rent Comp (Address, City, State, Unit Type, Current Rent, Market Rent, Renovated Rent Premium)
- Delete comp
- Auto-filtered by city on deal detail page

### 4.7 Tasks (`/tasks`)

- Global task view across all deals
- Fields: Title, Description, Due Date, Priority (Low/Medium/High/Critical), Deal link, Completed toggle
- Inline edit, delete
- Color-coded overdue/due-today/upcoming indicators

### 4.8 Settings (`/settings`, admin only)

- Profile & Security (name, password change)
- Notification Preferences (email toggles, frequency)
- Default Assumptions (pre-fill values for new scenarios)
- Checklist Templates (view stage-specific checklists)

### 4.9 Share (`/share/[token]`)

- Public read-only deal view (no auth required)
- 30-day expiring token
- Shows property details, metrics, scenario KPIs
- No edit capability

### 4.10 Pipeline Compare (`/pipeline/compare`)

- Select up to 4 deals
- Side-by-side comparison: Property info, Pricing, Buy Box scores, Source/Stage

---

## 5. API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/api/deals` | List/Create deals |
| GET/PUT/DELETE | `/api/deals/[id]` | Read/Update/Delete deal |
| POST | `/api/deals/import-url` | Import deal from listing URL |
| GET/POST | `/api/scenarios` | List/Create scenarios |
| GET/PUT/DELETE | `/api/scenarios/[id]` | Read/Update/Delete scenario (supports `clone_from`) |
| GET/POST | `/api/comps` | List/Create market comps |
| GET/DELETE | `/api/comps/[id]` | Read/Delete market comp |
| GET/POST | `/api/rent-comps` | List/Create rent comps |
| GET/DELETE | `/api/rent-comps/[id]` | Read/Delete rent comp |
| GET/POST | `/api/contacts` | List/Create contacts |
| GET/PUT | `/api/contacts/[id]` | Read/Update contact |
| GET/POST | `/api/tasks` | List/Create tasks |
| PUT/DELETE | `/api/tasks/[id]` | Update/Delete task |
| GET | `/api/export/[dealId]` | Export XLSX |
| GET | `/api/export/[dealId]/pdf` | Export PDF |
| GET | `/api/export/csv` | Export all deals CSV |
| POST | `/api/share` | Create share link |
| GET/PUT | `/api/settings` | Read/Update user settings |
| GET | `/api/search` | Global search |
| POST | `/api/auth/forgot-password` | Send reset email |
| PUT | `/api/auth/reset-password` | Reset password |
| POST | `/api/seed` | Seed demo data |
| POST | `/api/seed/brokers` | Seed broker contacts |
| POST | `/api/webhooks/email` | Inbound email webhook |

---

## 6. Data Models

### Deal
Core entity. ~80 fields covering property info, pricing, financials, building details, LOI, DD, closing, rent roll, T12, buy box scores, contacts, and audit timestamps.

### Scenario
Per-deal financial model. Contains: purchase, financing, revenue, expense, capex, and exit assumptions. Stores calculated monthly pro forma and summary metrics. Supports active/archived states and version tracking.

### Contact
Name, email, phone(s), type (Broker/Lender/Attorney/Advisor/Other), company, tags, notes.

### Task
Title, description, due_date, priority (low/medium/high/critical), completed flag, deal_id.

### RentRollUnit
Per-unit lease data: unit number, type, sqft, tenant, status, lease dates, current/market rent, other charges.

### T12Statement
12-month operating history: per-month income (GPR, vacancy, laundry, parking, etc.) and expenses (taxes, insurance, utilities, R&M, payroll, management, etc.).

### ChecklistInstance
Stage-specific checklist with items and completion states.

---

## 7. Competitive Landscape

| Product | Strengths | Weaknesses vs Monument Equity |
|---|---|---|
| **IMS (Investor Management Services)** | Investor portal, fund management, capital calls | No underwriting engine, enterprise pricing ($500+/mo), overkill for small teams |
| **Juniper Square** | LP reporting, fund admin, document management | No deal sourcing/pipeline, no underwriting, $1000+/mo |
| **DealCheck** | Quick analysis, mobile-friendly, cap rate calculator | No pipeline management, no CRM/contacts, limited scenario modeling, no T12 import |
| **RealPage/Yardi** | Property management, accounting, full ops | Not acquisition-focused, massive learning curve, enterprise contracts |
| **ARGUS Enterprise** | Institutional-grade DCF modeling, lease-by-lease | $10K+/yr, steep learning curve, no pipeline/CRM, desktop-only |
| **RCAnalytics / Real Capital Analytics** | Market data, transaction database | Data-only — no deal management or underwriting |
| **Stessa** | Free rental tracking, nice UX | Post-acquisition only — no pipeline, no underwriting, no scenarios |
| **REI Hub / Buildium** | Bookkeeping, tenant management | Operational — not acquisitions-focused |
| **Google Sheets / Excel** | Infinitely customizable, free | No pipeline view, no CRM, no scenario management, no auto-calculations, error-prone, no sharing/permissions |

**Monument Equity's differentiators:**
1. **Integrated pipeline + underwriting** — Kanban deal flow feeds directly into financial modeling
2. **Multi-scenario comparison** — Clone scenarios, tweak assumptions, compare outcomes side-by-side
3. **Self-contained** — Contacts, tasks, checklists, comps, T12, rent roll all in one system
4. **Lightweight** — No enterprise overhead, works for 1-5 person teams
5. **Modern stack** — Fast, responsive, dark-themed UI built with React 19 / Next.js 16
6. **Affordable** — Serverless architecture (Redis + Vercel) keeps costs near zero

---

## 8. QA Audit — Spec vs. Actual Build

### 8.1 Deal Detail Page

| Item | Spec | Status | Notes |
|---|---|---|---|
| Header with Google Maps link | Address + city linked to Maps | **PASS** | Both address and city/state link to Maps |
| Underwrite button | Green button linking to /underwrite | **PASS** | Visible to all roles |
| Share button (admin) | Admin-only dropdown | **PASS** | Wrapped in AdminOnly |
| Stage selector (admin) | Dropdown for stage changes | **PASS** | Wrapped in AdminOnly |
| Status actions (admin) | Dead/Pass/Reactivate | **PASS** | Wrapped in AdminOnly |
| KPI Bar with scenario selector | 8 metrics + dropdown to switch scenarios | **PASS** | Dropdown shows all active scenarios, metrics update on switch |
| Property Details — no bid_price | Removed from this card | **PASS** | bid_price removed, lives in scenarios now |
| Property Details — "Notes" label | Renamed from "Market Notes" | **PASS** | Label shows "Notes" |
| Property Details — no LOI section | Moved to scenarios | **PASS** | LOI section removed |
| Property Details — no Seller/Broker section | Moved to own card | **PASS** | Section removed from this card |
| Property Details — no DD/Closing section | Moved to own card | **PASS** | Section removed from this card |
| Seller/Broker Financials card | Standalone card with NOI, occupancy, taxes, insurance, tax URL | **PASS** | New component, collapsible |
| Due Diligence & Closing card | Standalone card with DD dates, closing, final price | **PASS** | New component, collapsible |
| T12 + Rent Roll removed | No longer on deal page | **PASS** | Grid removed, data lives in scenarios |
| Comps card | Tabbed: Market Sales, Rent Comps, Crexi | **PASS** | Filtered by deal city |
| Contacts / Neighborhood / Activity | 3-column layout | **PASS** | Contacts with add/search, neighborhood links, activity feed |
| Buy Box Scorecard | Conditional on stage | **PASS** | Shows for lead/screening/analysis only |
| Tasks & Checklists | 2-column layout | **PASS** | Task list + checklist panel |

### 8.2 Underwriting Page

| Item | Spec | Status | Notes |
|---|---|---|---|
| Scenario tabs | Tab per scenario with active highlight | **PASS** | Blue highlight for active |
| Create scenario | Button with type options | **PASS** | Base/Upside/Downside/Value-Add/Sale/Custom |
| Clone scenario | Context menu → Clone | **PASS** | API supports `clone_from`, UI has Clone option |
| Rename scenario | Context menu → Rename, inline edit | **PASS** | Input field appears on rename, saves on blur/enter |
| Archive scenario | Context menu → Archive with confirm | **PASS** | Confirmation dialog |
| Delete scenario | Context menu → Delete with confirm | **PASS** | Confirmation dialog |
| Show/hide archived | Toggle button with count | **PASS** | Shows archived count badge |
| Export Excel | Button per scenario | **PASS** | Opens /api/export/[dealId]?scenario_id= |
| Full AssumptionsForm | All sections with editable fields | **PASS** | Replaced quick-edit with full form |
| Purchase & Financing section | 9 fields | **PASS** | Purchase price, closing costs, earnest money, LTV, rate, amort, term, IO, origination |
| Bid & LOI section | 4 fields (bid price, LOI amount, LOI date, earnest money) | **PASS** | New section added |
| Revenue & Rent Roll section | Unit mix table + 4 revenue fields | **PASS** | Add/remove unit types, other income, vacancy, bad debt, rent growth |
| T12 Import section | Shows T12 totals + Import button | **PASS** | Conditional on deal having T12 data, imports to expense fields |
| Operating Expenses section | 11 expense fields | **PASS** | Per-unit and annual formats |
| CapEx Per-Unit section | 3 fields | **PASS** | Cost/unit, units to renovate, units/month |
| CapEx Named Projects | Add/remove projects with 4 fields each | **PASS** | Name, cost, start month, duration |
| Exit/Refi/Sale section | 3 fields | **PASS** | Hold period, exit cap, selling costs |
| Metrics Bar | 8 metrics with color coding | **PASS** | Green/yellow/red thresholds |
| Pro Forma Table | Annual + Monthly toggle | **PASS** | Year selector for monthly view |
| Sensitivity Grid | 5×5 purchase price × exit cap | **PASS** | IRR values with color coding |
| Recalculate button | Shows when form is dirty | **PASS** | Triggers API PUT + recalculation |

### 8.3 Calculation Engine

| Item | Spec | Status | Notes |
|---|---|---|---|
| Purchase price feeds into caps, equity | Used for going-in cap, stabilized cap, loan amount | **PASS** | Verified in underwriting.ts |
| LOI fields are metadata only | Don't affect calculations | **PASS** | bid_price, loi_amount, loi_date, loi_expiration not used by engine |
| Scenarios auto-recalculate on save | PUT recalculates immediately | **PASS** | Both POST and PUT run calculateUnderwriting() |
| Clone preserves all assumptions | Copies all 6 assumption groups | **PASS** | Spread operator copies all fields, recalculates |
| T12 import populates expenses | Converts annual totals to per-unit | **PASS** | Taxes (total), insurance/utilities/R&M (per-unit), payroll/admin/contracts (annual) |
| IRR calculation | Newton's method on cash flows | **PASS** | lib/irr.ts implementation |
| Sensitivity grid | 5×5 price vs exit cap | **PASS** | ±10% price, ±1% cap rate |
| Monthly debt service | IO period → amortizing transition | **PASS** | Verified in underwriting.ts |

### 8.4 API

| Item | Spec | Status | Notes |
|---|---|---|---|
| POST /api/scenarios with clone_from | Clones source scenario | **PASS** | Full implementation with activity logging |
| PUT /api/scenarios/[id] with name | Renames scenario | **PASS** | `name: body.name ?? existing.name` |
| GET /api/scenarios/[id] recalculates | Fresh calculation on read | **PASS** | Reconstructs inputs, runs engine |
| Activity logging on scenario CRUD | Logs create/update/delete | **PASS** | logActivity calls in all handlers |

### 8.5 Issues / Gaps Found

| # | Severity | Issue | Details |
|---|---|---|---|
| 1 | **Low** | Earnest money not used in calculations | Stored in PurchaseAssumptions but never referenced by the engine. Consider using it in equity calculation or documenting it as metadata. |
| 2 | **Low** | DealAssumptionsPanel still exists | `src/components/deals/deal-assumptions-panel.tsx` is no longer imported on the deal page but the file still exists. Could be cleaned up to avoid confusion. |
| 3 | **Low** | RentRollTable and T12StatementPanel still exist | Components removed from deal page but files remain. The deal still stores rent_roll and t12 data — these components could be repurposed for the scenario form or cleaned up. |
| 4 | **Medium** | T12 import only shows when deal has T12 data | If no T12 was entered on the (now removed) T12 panel, the import section won't appear. Need an alternative way to enter T12 data or surface it in scenarios directly. |
| 5 | **Low** | `getContactDisplayName` import was removed | Cleaned up unused import — no functional impact. |
| 6 | **Info** | Bid price on deal-level still exists in schema | `deal.bid_price` field remains in the Deal type. Not displayed on the deal page but still stored. CSV export references it. |

---

## 9. Summary

Monument Equity is a well-structured, modern real estate deal management platform with a clear separation between:

1. **Property facts** (deal detail page) — immutable physical characteristics, seller data, DD/closing milestones
2. **Financial scenarios** (underwrite page) — self-contained models with bid/LOI, assumptions, T12 import, full pro forma output
3. **Deal workflow** (pipeline, tasks, checklists) — tracking progress through acquisition stages

The build matches the spec across all major features. The calculation engine is sound, scenarios are self-contained and cloneable, and the KPI bar allows quick scenario switching on the deal page. The primary gap is the T12 data entry path now that the standalone T12 panel was removed from the deal page — teams that haven't previously entered T12 data won't see the import option in scenarios.
