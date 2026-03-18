# Plan: Separate Property Facts from Scenario Data

## Goal
Clean separation between immutable property facts, deal workflow tracking, and scenario-based financial analysis.

## Changes

### 1. EditablePropertyDetails — Trim to property facts only
- Remove `bid_price` field
- Rename "Market Notes" → "Notes"
- Remove LOI Details section (moves to scenarios)
- Remove Seller/Broker Financials section (moves to own card)
- Remove Due Diligence & Closing section (moves to own card)

### 2. New Card: SellerBrokerFinancials
- Standalone card on deal detail page
- Fields: current_noi, current_occupancy, current_annual_taxes, current_annual_insurance, tax_record_url
- Editable, saves to deal

### 3. New Card: DueDiligenceClosing
- Standalone card on deal detail page
- Fields: dd_start_date, dd_end_date, closing_date, final_purchase_price
- Editable, saves to deal

### 4. Scenario Schema — Add LOI + bid price + T12 snapshot fields
- Add to scenario assumptions: `bid_price`, `loi_amount`, `loi_date`, `loi_expiration`, `earnest_money`
- These go into `purchase_assumptions` alongside `purchase_price`, `closing_cost_rate`
- Add `t12_snapshot` to scenario — annual totals from T12 that feed the expense assumptions
- When creating a scenario, auto-populate T12 data from deal's T12 if available

### 5. AssumptionsForm — Add new sections
- Add "Bid & LOI" section with: bid_price, loi_amount, loi_date, earnest_money
- Add "T12 Operating Statement" section showing annual T12 totals with "Import to Expenses" button
- Keep existing sections (Purchase & Financing, Revenue, Expenses, CapEx, Exit)

### 6. Clone + Rename Scenarios
- Add "Clone" option to scenario context menu (both DealAssumptionsPanel and UnderwritingClient)
- Clone creates a copy with all assumptions duplicated, named "{original} (Copy)"
- Add inline rename on scenario tab (double-click or rename menu option)

### 7. Remove standalone RentRollTable + T12StatementPanel from deal page
- The "Revenue & Rent Roll" section in assumptions form already has unit mix
- T12 data now lives in scenarios
- Remove the T12 + Rent Roll grid from deal detail page

### 8. Deal Detail Page — Updated layout
1. Header (existing)
2. KPI Bar (existing)
3. Property Details (trimmed)
4. Seller/Broker Financials (new card)
5. Due Diligence & Closing (new card)
6. Comps (existing)
7. Contacts, Neighborhood, Activity (existing)
8. Buy Box Scorecard (existing, conditional)
9. Tasks & Checklists (existing)

### 9. API changes
- `POST /api/scenarios` — support `clone_from` parameter
- `PUT /api/scenarios/[id]` — support `name` field update for rename
- Scenario creation seeds T12 data from deal when available
