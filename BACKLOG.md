# Monument Equity — Backlog

## Enhance Contacts (CRM)

Add fields and features to replace the Google Sheets contact tracker:

- **New fields**: priority (A/B/C), status (prospect/active/inactive/closed), connection/source (how you know them), DNC flag (do not call)
- **Follow-up tracking**: next action (free text), next action date — surface overdue follow-ups on dashboard
- **Last contacted**: auto-update `last_contacted_at` when logging interactions
- **Contact activity log**: log calls, emails, meetings, notes against a contact (not just deals) with timestamps
- **Contact import**: CSV import from Google Sheets (map columns to fields)
- **Dashboard widget**: contacts needing follow-up (overdue next action date)

Source spreadsheet columns: First Name, Last Name, Role, Company, City, State, Email 1, Email 2, Phone 1, Phone 2, DNC, Category, Connection/Source, Status, Priority, Next Action, Next Action Date, Date Added, Last Contact, Notes

## REPS Time Tracker (Real Estate Professional Status)

New Insights/Reporting page with IRS-compliant hour logging for RE Professional Status qualification:

- **Hour log**: date, activity category, description, start time, end time, hours (computed), property/notes
- **Activity categories** (IRS qualifying): Acquisition, Brokerage, Construction, Conversion, Development, Leasing, Management, Operation, Reconstruction, Redevelopment, Rental
- **REPS dashboard**: 750-hour test progress bar, more-than-half test status, weekly pace (avg hours/week needed for remaining weeks), hours YTD vs target
- **Monthly summary**: hours by category by month, chart visualization
- **Material participation**: track which of the 7 IRS tests is being met per rental activity
- **Export**: CSV/PDF export of hour log for tax preparer

## Listing Feed Integration

Explore connecting daily Crexi/LoopNet listing updates into the app — auto-import new listings, track price changes, flag matches against buy box criteria. TBD on approach (email parsing, API, manual upload).
