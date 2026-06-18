# Cedar Grove Analytics — Firestore Schema

## Overview

This document defines the Firestore database schema for Cedar Grove Analytics, a legal time tracking and billing dashboard. The system syncs user timesheet data from Google Sheets into Firestore and serves it to a Next.js dashboard.

The schema stores entry data in **per-month array documents**: all billable entries for a given user and month live in a single document, as do ops entries and 83(b) elections. This eliminates duplication from multiple sync runs and minimizes Firestore reads. The dashboard aggregates data client-side from these entry arrays.

---

## Data Source

Each user has a Google Sheets workbook named `{year} - Invoices ({lastName})` (e.g., `2026 - Invoices (Ohta)`). Each workbook contains one sheet per month (January, February, etc.).

Each sheet has a header row (row 9) with the following columns:

| Columns 1–8 (Billable Work) | Columns 10–13 (Ops Work) | Columns 15–17 (83(b) Elections) |
|---|---|---|
| Client | Ops (description) | Company |
| Date | Category | Name |
| Hours | Date | Flat Fee |
| Billables Earnings | Hours | |
| Billing Category | | |
| Matter | | |
| Reimbursements | | |
| Notes | | |

A single sheet row may contain billable data, ops data, both, or an 83(b) election entry. The sync script parses each row and writes to the appropriate collections based on which columns have data.

**Current layout (row-11 tabs) + the McClure "Adjustment ($)" column:** newer tabs put the header on **row 11** (entries from row 12). Sam McClure's workbook additionally inserts an **"Adjustment ($)"** column at **D**, which shifts "Billables Earnings" to **E** (`= Hours × Rate + Adjustment`) and pushes every later billable / ops / 83(b) / reimbursement column **+1** (e.g. ops Hours moves M → N). To stay robust to the shift — and to the fact that the column exists only in McClure's workbook — the sync should locate billable-block columns **by header name** rather than by fixed letters. See `docs/timesheet-sync.md` §8 for the Apps Script steps.

Rows 1–8 contain summary totals that are synced as `sheetTotals` metadata on the Firestore documents for dashboard validation:

| Row | Column A Label | Column B Value | Column E Label | Column F Value |
|-----|---------------|----------------|----------------|----------------|
| 1 | Total Billable Hours | 87.40 | Ops Hours | 102.7 |
| 2 | Billable Earnings | $29,497.50 | Total Hours (Ops/Billables) | 190.10 |
| 3 | Reimbursements | $686 | | |
| 4 | Rate | $337.50 | | |
| 5 | 83(b) Fee Earnings | $162.50 | | |
| 6 | Total Payment | $30,346.20 | | |
| 7–8 | *(blank / section header)* | | | |

**Note:** The Rate field (row 4) represents the attorney's take-home rate, not their billing rate, and is intentionally **not synced**. Some sheets do not have ops or 83(b) sections — those values will be `0`.

---

## Collection Structure

```
firestore-root/
│
├── users/{userId}/                       # User profile document (name, role, email)
│   ├── rates/{year}_{month}              # Billing rate for one month
│   ├── targets/{year}_{month}            # Performance targets for one month
│   ├── billables/{year}_{month}          # All billable entries for one month
│   ├── ops/{year}_{month}                # All ops entries for one month
│   └── eightThreeB/{year}_{month}        # 83(b) election entries for one month
│
├── clients/all                           # All client records in a single document (clients array)
│
├── matters/{autoId}                      # Matter records for billing matter dropdowns
│
├── admins/{email}                        # Admin role — document existence = admin
│
├── invoices/all                          # All client invoices in a single document (entries array)
│
├── monthlyMetrics/all                    # Firm-wide per-month metrics (entries array)
│
├── clientAliases/all                     # Counterparty-to-client name mappings (for invoice matching)
│
├── transactions/{mercuryId}              # Bank transactions synced from Mercury API
│
└── driveDownloads/{monthKey}             # Google Drive download events per month
```

### Document ID Format

All per-month documents use the ID format `{year}_{month}` (e.g., `2026_January`). The year is always derived from the spreadsheet name, never from date cell parsing.

### User IDs

User IDs are full names as stored in Firestore: `"Michael Ohta"`, etc. These are used as document IDs in the `users` collection and as the `userId` field on all entry data.

---

## Document: `users/{userId}`

The user profile document. Stores identity, role, billing rate, and performance targets. This document is created and maintained via the admin User Management page (`/admin/user-management`) — the sync script does not read or write to it.

### Document Schema

```javascript
{
  name: "Michael Ohta",                   // string — display name
  role: "Attorney",                        // string — "Attorney", "Legal Operations Associate", etc.
  email: "michael@cedargrove.law",         // string — login email (used for access control)
  employmentType: "FTE",                   // string — "FTE" (full-time) or "PTE" (part-time)
  active: true,                            // boolean — false hides attorney unless timeframe overlaps their data (absent = active)

  // Billing rates (one entry per active month)
  // `rate` is the CLIENT billing rate (drives rate × hours billables).
  // `takeHomeRate` is the attorney's take-home hourly rate, mirrored from the
  // invoice sheet's rate table — optional; absent where the sheet has no
  // explicit value (e.g. Sam's Jan–Sep 2025 founder-model months). Actual
  // take-home dollars still come from per-entry `earnings`, not this field.
  rates: [
    { month: "January", year: 2026, rate: 600, takeHomeRate: 337.50 },
    { month: "February", year: 2026, rate: 615, takeHomeRate: 337.50 },
    { month: "March", year: 2026, rate: 615, takeHomeRate: 337.50 }
    // ... one entry per month the user is active
  ],

  // Monthly targets (one entry per active month)
  targets: [
    {
      month: "January",
      year: 2026,
      billableHours: 100,                  // number — target billable hours
      opsHours: 80,                        // number — target ops hours
      totalHours: 180,                     // number — target total hours
      earnings: 33750.00                   // number — target earnings
    },
    {
      month: "February",
      year: 2026,
      billableHours: 100,
      opsHours: 80,
      totalHours: 180,
      earnings: 33750.00
    }
    // ... one entry per month the user is active
  ]
}
```

### User Roles

Current roles include:

- `"Attorney"` — licensed attorneys who bill client hours
- `"Legal Operations Associate"` — operations staff who track ops hours

The role is a free-text field on the user document, not on individual entry documents. The dashboard reads the user profile once and applies the role for display, filtering, and grouping.

### Email & Access Control

The `email` field on the user document is used for access control. When a non-admin user logs in, the dashboard matches their Firebase Auth email against user documents to determine which attorney detail page they can access. Non-admin users are automatically redirected to their own attorney page on login. Admin users can access all pages.

### Employment Types

- `"FTE"` — Full-time employee
- `"PTE"` — Part-time employee

The employment type is set via the admin User Management page. New users default to `"PTE"`. Existing users without the field default to `"FTE"` at read time.

### Active Status

The `active` boolean marks whether an attorney is a current member of the firm. Set via the **Active** toggle in the admin User Management → Role Management tab (`/admin/user-management`). Users without the field default to `active: true` at read time.

- **Active** (`true` / absent): always shown in dropdowns, attorney rows, Targets, and Projected Earnings.
- **Inactive** (`false`): hidden from those surfaces **except** when the selected timeframe overlaps the attorney's actual billable/ops entries — visibility is auto-derived from entry dates, so no tenure start/end dates are stored. Inactive attorneys are always excluded from forward-looking Targets and Projected Earnings.

This is layered on top of the legacy hardcoded `src/utils/hiddenAttorneys.js` date config (both are consulted). Aggregate firm totals continue to include hidden/inactive attorneys.

### Rate and Targets

Both `rates` and `targets` are arrays with one entry per active month, keyed by `month` and `year`. This allows rates and goals to change over time while preserving historical values for any given month.

The `rates` array stores the user's hourly billing rate for each month. The rate in the spreadsheet (row 4) is informational only; the Firestore value is the source of truth for the dashboard. When a rate changes (e.g., an annual increase), a new entry is added for subsequent months — previous months retain their original rate.

The `targets` array stores monthly performance goals. These are used by the dashboard to render progress indicators, percentage-of-target metrics, and pacing calculations. Targets can vary month to month (e.g., reduced targets during holidays or ramp-up periods).

The dashboard looks up the rate and targets for the selected month by matching on `month` + `year`. If no entry exists for a given month, the dashboard can fall back to the most recent prior entry or display no target.

---

## Collection: `users/{userId}/billables/{year}_{month}`

Stores all billable time entries for one user for one month as an array within a single document. Each element in the `entries` array represents one row from the billable (left-side) columns of the spreadsheet.

Only rows that have at least one of: client, billable date, or billable hours are included.

### Document Schema

```javascript
{
  // Metadata
  userId: "Michael Ohta",                // string — full user name
  month: "January",                      // string — month name
  monthNumber: 1,                        // number — 1-indexed month (1 = January)
  year: 2026,                            // number — derived from spreadsheet name
  syncedAt: Timestamp,                   // Firestore Timestamp — when this doc was last written
  entryCount: 218,                       // number — length of entries array

  // Sheet summary totals (from rows 1–8 of the spreadsheet, used for dashboard validation)
  sheetTotals: {
    totalBillableHours: 87.40,           // number — from row 1 col B
    billableEarnings: 29497.50,          // number — from row 2 col B (includes Adjustments)
    reimbursements: 686.00,              // number — from row 3 col B
    adjustment: 0,                       // number — Σ Adjustment ($) column (McClure only)
    totalPayment: 30346.20,              // number — from row 6 col B
  },

  // Entry array
  entries: [
    {
      client: "C47 Inc.",                // string — client name
      date: Timestamp,                   // Firestore Timestamp — billable date
      hours: 0.6,                        // number — billable hours
      earnings: 203.00,                  // number — dollar amount (parsed from "$203" format); = Hours×Rate + Adjustment
      adjustment: 0,                     // number — manual month-end +/- adjustment (McClure only); folded into earnings
      billingCategory: "General Diligence", // string — billing category
      matter: "YC Application Questions",   // string — matter name (may be empty)
      reimbursements: 0,                 // number — reimbursement amount
      notes: "Review corporate records", // string — work description
      sheetRowNumber: 11                 // number — original row in the spreadsheet (for debugging)
    }
    // ... one object per billable row
  ]
}
```

### Field Notes

- `earnings`: Parsed from the spreadsheet's currency format (e.g., `"$709"` or `"$29,497.50"` → `709` or `29497.50`). Stored as a plain number, not a string. On Sam McClure's current-layout tabs this column is `Hours × Rate + Adjustment`, so it already includes any month-end adjustment.
- `adjustment`: Manual month-end dollar adjustment — positive = extra charge, negative = credit/discount — used on **Sam McClure's** timesheet only to tune a client's final bill without logging time. In the current (row-11) layout it is column **D**, which makes "Billables Earnings" column **E** (`= Hours × Rate + Adjustment`). Defaults to `0`; absent on other attorneys' workbooks and on legacy (row-9) tabs. Folded into `earnings`, so on the dashboard it is informational and must **not** be summed on top of earnings.
- `date`: The billable date from the spreadsheet. Dates in the sheet are formatted as `M/D` (e.g., `1/2`, `1/14`). The year is appended from the spreadsheet name during sync. Stored as a Firestore Timestamp.
- `matter`: May be empty string if no matter is specified for that entry.
- `reimbursements`: Defaults to `0` if the cell is empty.
- `sheetRowNumber`: The actual row number in the spreadsheet (1-indexed, accounting for the header row at row 9). Used only for debugging and tracing back to the source data.
- `sheetTotals`: Summary values from the spreadsheet header (rows 1–8). Used by the dashboard to validate that computed entry sums match the spreadsheet's own totals. The `totalPayment` field represents the total of billable earnings + reimbursements + 83(b) fees. Not present on documents synced before this feature was added.

---

## Collection: `users/{userId}/ops/{year}_{month}`

Stores all ops (non-billable) time entries for one user for one month. Structure mirrors billables but with ops-specific fields.

Only rows that have at least one of: ops description, ops date, or ops hours are included.

### Document Schema

```javascript
{
  // Metadata
  userId: "Michael Ohta",
  month: "January",
  monthNumber: 1,
  year: 2026,
  syncedAt: Timestamp,
  entryCount: 157,

  // Sheet summary totals (from rows 1–8 of the spreadsheet, used for dashboard validation)
  sheetTotals: {
    opsHours: 102.70,                    // number — from row 1 col F
    totalHours: 190.10,                  // number — from row 2 col F (billable + ops combined)
  },

  // Entry array
  entries: [
    {
      description: "Work on Ironclad incorporation workflow", // string — ops work description
      date: Timestamp,                   // Firestore Timestamp — ops date
      hours: 3.5,                        // number — ops hours
      category: "Systems & Automation",  // string — ops category
      sheetRowNumber: 11                 // number — original spreadsheet row
    }
    // ... one object per ops row
  ]
}
```

### Field Notes

- `description`: The "Ops" column from the spreadsheet — a free-text description of the non-billable work.
- `category`: The ops category (e.g., "Systems & Automation", "Business Development", "Team Meeting", "Billing", "Knowledge Management", "Pro Bono", "Write-Off", "Employee Matters", "Motions/Forms", "Educational Content").
- `date`: The ops date column (the second "Date" column in the spreadsheet). May differ from the billable date on the same row.
- A single spreadsheet row can produce both a billable entry and an ops entry. They share the same `sheetRowNumber` but live in different collections.

---

## Collection: `users/{userId}/eightThreeB/{year}_{month}`

Stores 83(b) election filings for one user for one month. These represent flat-fee administrative filings that are separate from hourly billable work and ops time.

Only rows that have at least one of: company name, individual name, or flat fee amount are included.

### Document Schema

```javascript
{
  // Metadata
  userId: "Michael Ohta",
  month: "January",
  monthNumber: 1,
  year: 2026,
  syncedAt: Timestamp,
  entryCount: 1,
  totalFlatFees: 250.00,              // number — sum of all flat fees in the entries array

  // Sheet summary totals (from rows 1–8 of the spreadsheet, used for dashboard validation)
  sheetTotals: {
    eightThreeBFeeEarnings: 162.50,    // number — from row 5 col B
  },

  // Entry array
  entries: [
    {
      company: "Refer Services, Inc.",   // string — company name
      name: "Renata Yumi Kobayashi",     // string — individual filing the 83(b)
      flatFee: 250.00,                   // number — flat fee amount
      sheetRowNumber: 10                 // number — original spreadsheet row
    }
    // ... one object per 83(b) filing
  ]
}
```

### Field Notes

- 83(b) elections appear in columns 15–17 of the spreadsheet (Company, Name, Flat Fee).
- A single spreadsheet row can have billable data, ops data, and an 83(b) entry simultaneously. Each goes to its respective collection.
- `totalFlatFees` is pre-summed at the document level for quick access without iterating the array.
- Months with no 83(b) entries will not have a document in this collection.

---

## Dashboard Usage

The dashboard aggregates data client-side from the raw entry arrays. There are no pre-computed summary documents.

| Dashboard View | Data Source | Reads per User |
|---|---|---|
| User profile (name, role, rate) | `users/{userId}` | 1 |
| KPI cards (hours, earnings) | `billables` + `ops` | 2 |
| Progress-to-target indicators | `users/{userId}` targets array (filter by month/year) | 0 (already loaded) |
| Client breakdown table | `billables` entries array | 0 (already loaded) |
| Billing category pie chart | `billables` entries array | 0 (already loaded) |
| Ops category breakdown | `ops` entries array | 0 (already loaded) |
| Daily trend line chart | `billables` + `ops` entries (group by date) | 0 (already loaded) |
| Matter-level drill-down | `billables` entries array | 0 (already loaded) |
| 83(b) election details | `eightThreeB/{year}_{month}` | 0–1 |
| Data validation warnings | `billables` + `ops` + `eightThreeB` sheetTotals | 0 (already loaded) |
| Cross-month trend (e.g., Q1) | Multiple `billables` + `ops` docs | 4–6 |

A typical month view for one user requires 4 reads: user profile, billables document, ops document, and eightThreeB document. The dashboard fetches all three subcollections for each user on initial load.

### Data Validation (Warnings)

The dashboard compares computed entry sums against the `sheetTotals` stored on each document and displays warnings on the team members table and attorney detail pages when mismatches are detected. The following checks are performed:

| Warning Type | Comparison |
|---|---|
| Date mismatch | Entry-level date vs parent document's month/year |
| Billable hours mismatch | Sum of entry `hours` vs `sheetTotals.totalBillableHours` |
| Billable earnings mismatch | Sum of entry `earnings` vs `sheetTotals.billableEarnings` |
| Ops hours mismatch | Sum of entry `hours` vs `sheetTotals.opsHours` |
| 83(b) fee earnings mismatch | Sum of entry `flatFee` vs `sheetTotals.eightThreeBFeeEarnings` |
| Total hours mismatch | (billable hours + ops hours) vs `sheetTotals.totalHours` |
| Total payment mismatch | (billable earnings + reimbursements + 83(b) fees) vs `sheetTotals.totalPayment` |

Because Sam McClure's `Adjustment ($)` is folded into the Billables Earnings column, both sides of the **Billable earnings** and **Total payment** checks already include it, so they continue to reconcile — no separate adjustment check is required. The synced `sheetTotals.adjustment` is informational.

Warnings only appear when `sheetTotals` are present on the document (i.e., after the sync script has been re-run to populate them).

---

## Sync Architecture

### Sync Flow

```
Google Sheet → Apps Script → Firestore
                  │
                  ├── 1. Parse sheet summary totals (rows 1–8)
                  ├── 2. Parse sheet entry rows (rows 10+)
                  ├── 3. Separate billable, ops, and 83(b) entries
                  ├── 4. Delete-and-replace: overwrite billables/{year}_{month}  (with sheetTotals)
                  ├── 5. Delete-and-replace: overwrite ops/{year}_{month}  (with sheetTotals)
                  └── 6. Delete-and-replace: overwrite eightThreeB/{year}_{month}  (with sheetTotals, if entries exist)
```

### Year Detection

The sync year is **always derived from the spreadsheet name**, never from date cell values:

```javascript
function getSpreadsheetYear(ss) {
  const name = ss.getName();
  const match = name.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1], 10) : new Date().getFullYear();
}
```

This prevents year detection bugs when date cells contain ambiguous formats like `1/2` (which could be parsed as any year depending on runtime context).

### Delete-and-Replace Strategy

Each sync overwrites the entire month's document in a single write operation. Because billables and ops are stored as arrays within single documents (not as individual subcollection documents), replacing a month's data is a single Firestore write per collection — no reads required for cleanup.

```javascript
// One write replaces all of January's billable entries
setDoc(doc(db, 'users', userId, 'billables', '2026_January'), {
  entries: [...parsedBillableEntries],
  // ... metadata
});
```

### Cost Per Sync (Per User Per Month)

| Operation | Reads | Writes |
|---|---|---|
| Write billables document | 0 | 1 |
| Write ops document | 0 | 1 |
| Write 83(b) elections document | 0 | 0–1 |
| **Total** | **0** | **2–3** |

### Triggers

- **Daily sync**: Triggered by Apps Script time-driven trigger. Syncs the current month for the active spreadsheet.
- **Manual sync**: `forceSyncSpecificMonth("January")` for re-syncing a specific month.
- **Full re-sync**: Iterates all 12 month sheets and syncs each.

---

## Row Parsing Rules

### Billable Entry (Left Side of Sheet)

A row produces a billable entry if it has at least one of:
- A non-empty `Client` value (column 1)
- A non-empty billable `Date` value (column 2)
- A non-zero billable `Hours` value (column 3)

### Ops Entry (Right Side of Sheet)

A row produces an ops entry if it has at least one of:
- A non-empty `Ops` description (column 10)
- A non-empty ops `Date` value (column 12)
- A non-zero ops `Hours` value (column 13)

### 83(b) Election Entry

Rows with data in columns 15–17 (Company, Name, Flat Fee) represent 83(b) election filings. These are tracked separately and do not count toward billable or ops hours.

### Skipped Rows

- Rows where all relevant columns are empty are skipped entirely.
- Rows 1–8 (summary area) are parsed for `sheetTotals` metadata only — they are not processed as entries.
- Rows after the last populated row in the sheet are ignored.
- Rows with `$0` earnings and no other data are skipped.

---

## Document: `invoices/all`

Stores all client invoice records in a single document as an entries array. Synced from the "Payment Status" sheet tab in the Invoices Google Sheets workbook.

### Data Source

The "Payment Status" sheet has a summary header in row 1 (skipped during sync) and invoice rows starting at row 2. Each row tracks one invoice sent to a client, including its payment status, reminder dates, and receipt dates.

### Document Schema

```javascript
{
  // Metadata
  entryCount: 148,                         // number — length of entries array
  syncedAt: "2026-02-10T12:00:00.000Z",   // string — ISO 8601 timestamp of last sync

  // Entry array
  entries: [
    {
      client: "BuildQ, Inc.",              // string — client name
      amount: 4115.00,                     // number — invoice amount (parsed from "$4,115" format)
      year: 2025,                          // number | null — year the invoice pertains to
      dateSent: "12/3",                    // string | null — date invoice was sent (M/D format)
      status: "Paid",                      // string | null — "Paid", "Not Paid", or "Payment Initiated"
      lastReminder: "1/6/2026",           // string | null — date of last payment reminder
      dateReceived: "2/9/2026",           // string | null — date payment was received
      notes: "Not reminder until end of feb", // string | null — freeform notes
      sheetRowNumber: 9                    // number — original row in the spreadsheet (for debugging)
    }
    // ... one object per invoice row
  ]
}
```

### Field Notes

- `amount`: Parsed from the spreadsheet's currency format (e.g., `"$4,115"` → `4115`). Stored as a plain number.
- `year`: The billing year the invoice belongs to (e.g., `2025` or `2026`). Some invoices from a prior year appear in the current year's workbook.
- `dateSent`: The date the invoice was sent to the client. Format varies — may be `M/D` (e.g., `2/3`) or `M/D/YYYY` (e.g., `1/6/2026`). Stored as-is from the sheet.
- `status`: One of `"Paid"`, `"Not Paid"`, or `"Payment Initiated"`.
- `lastReminder`: Date a payment reminder was last sent. May be `M/D` or `M/D/YYYY` format, or null if no reminder was sent.
- `dateReceived`: Date payment was received. May be `M/D` or `M/D/YYYY` format, or null if not yet paid.
- `notes`: Freeform notes (e.g., payment method details, follow-up instructions). May be null.
- `sheetRowNumber`: The actual row number in the spreadsheet (1-indexed). Used for debugging and tracing back to the source data.
- A single client may have multiple entries in the array (one per billing period or invoice sent).

### Sync Architecture

```
Google Sheet ("Payment Status" tab) → Apps Script → Firestore
                                          │
                                          ├── 1. Read all rows from row 2 onward
                                          ├── 2. Skip rows with no client name
                                          ├── 3. Parse currency amounts, trim strings
                                          └── 4. Overwrite invoices/all with entries array + metadata
```

- **Sync trigger**: Manual — run `syncInvoices()` or `forceSyncInvoices()` from Apps Script.
- **Strategy**: Full overwrite. The entire `invoices/all` document is replaced with the parsed entries array and metadata in a single write.
- **Cost per sync**: 1 write.

---

## Document: `monthlyMetrics/all`

Stores firm-wide per-month metrics in a single document as an entries array. Synced from the monthly sheet tabs in the rates Google Sheets workbook (cell B10 of each month sheet contains "Revenue Accrued").

### Document Schema

```javascript
{
  entryCount: 5,                            // number — length of entries array
  lastSyncedAt: "2026-05-04T...",           // string — ISO 8601 timestamp of last sync

  entries: [
    {
      month: "January",                     // string — month name
      year: 2026,                           // number

      revenueAccrued: 256835,               // number — Revenue (Accrued), parsed from cell B10
      attorneyBillables: 260193,            // number — "Attorney Billables" line from the sheet's
                                            //   billing-summary table. Optional (present once the
                                            //   sync writes it). Pulled directly, not derived.

      syncedAt: "2026-05-04T..."            // string — ISO 8601 timestamp this entry was last synced
    }
    // ... one entry per synced month, sorted chronologically
  ]
}
```

### Field Notes

- `revenueAccrued`: Parsed from cell B10 of the month sheet. Currency strings are normalized to plain numbers via `parseCurrency`.
- `attorneyBillables`: The "Attorney Billables" line from the month sheet's billing-summary table, pulled **directly** from the sheet (not derived from rate × hours). **Optional** — present once the sync writes it. Stored as a plain number (the dashboard checks `typeof === 'number'`; `parseCurrency` already returns numbers). Surfaced on the Billing Summaries page and used for the Overview "Total Billables" KPI on month-aligned date ranges (a month in progress or completed months); custom or partial ranges fall back to rate × hours.
- `month` + `year`: Composite key. Re-syncing the same month replaces its entry rather than appending.
- Entries are sorted chronologically (year, then month index).

### Sync Architecture

```
Google Sheet ({Month} tab) → Apps Script → Firestore
                                          │
                                          ├── 1. Read existing entries[] from monthlyMetrics/all
                                          ├── 2. Read B10 (Revenue Accrued) + the "Attorney
                                          │      Billables" line (matched by column-A label text)
                                          ├── 3. Upsert entry by month+year, sort
                                          └── 4. PATCH entries field (preserves other doc fields)
```

- **Sync trigger**: Manual — run `forceSyncRevenueAccrued()` (current month) or `forceSyncRevenueAccruedSpecificMonth()` (named month).
- **Strategy**: Field-level PATCH on `entries`. Read-modify-write to upsert one month at a time without overwriting other months.
- **Cost per sync**: 1 read, 1 write.

#### Reading Attorney Billables (label-based)

`attorneyBillables` is pulled directly from the "Attorney Billables" line of the
month sheet's billing-summary table. Match the **column-A label text** (case-
insensitive, trimmed) rather than a hardcoded cell address, so minor label edits
don't break the sync. Read the adjacent value with the existing `parseCurrency`
helper (which returns a plain number):

```javascript
function readAttorneyBillables(sheet) {
  var rows = sheet.getRange('A1:B40').getValues(); // generous label/value window
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() === 'attorney billables') {
      return parseCurrency(rows[i][1]); // returns a number
    }
  }
  return null;
}

// In forceSyncRevenueAccrued*, add it to the upserted entry alongside revenueAccrued:
//   var entry = { month: month, year: year, syncedAt: now,
//                 revenueAccrued: parseCurrency(sheet.getRange('B10').getValue()) };
//   var ab = readAttorneyBillables(sheet);
//   if (ab != null) entry.attorneyBillables = ab;
```

Keep `parseCurrency` returning numbers — the dashboard checks `typeof === 'number'`.

---

## Document: `timeOff/all`

Stores firm-wide **out-of-office (OOO)** and **holiday** data in a single document, synced from the firm's shared Google Calendar. Consumed read-only by the dashboard to OOO/holiday-adjust utilization targets — it is never written by the app.

### Document Schema

```javascript
{
  holidays: [                               // firm holidays, one entry PER DAY
    { date: "2026-07-03",                   // string — 'YYYY-MM-DD' (PST calendar day)
      name: "Independence Day (observed)" } // string — label (informational)
  ],

  outOfOffice: [                            // per-person OOO, one entry per calendar event
    { name:  "Nicholas Vail",               // string — canonical attorney display name
      email: "nick@cedargrovellp.com",      // string — attorney email (preferred join key)
      start: "2026-06-01",                  // string — 'YYYY-MM-DD', INCLUSIVE
      end:   "2026-06-05",                  // string — 'YYYY-MM-DD', INCLUSIVE
      title: "Nick - PTO" }                 // string — original event title (informational)
  ],

  lastSyncedAt: "2026-06-03T08:00:00Z",     // string — ISO 8601 timestamp of last sync
  source: "Firm Calendar (shared)"          // string — provenance label
}
```

### Field Notes

- **Dates** are PST calendar-day strings `YYYY-MM-DD` (no time component).
- `holidays` is **pre-expanded to one entry per day** — the Apps Script expands any multi-day holiday event into individual days. A holiday on a weekend has no effect (the dashboard only counts weekdays).
- `outOfOffice[].start`/`end` are an **inclusive** range. Store **both** `name` and `email` so the dashboard can join on either.
- **Optional** — the whole document may be absent until the sync ships. The dashboard then falls back to the hardcoded US federal holidays (via `getUSFederalHolidays`) and applies no OOO, i.e. behavior is unchanged.

### How It's Used

- `utils/timeOff.js` `parseTimeOff` turns the doc into a holiday date-set plus OOO date-sets keyed by email and by normalized name.
- Target pro-rating (`getMonthProRateFraction` in `utils/dateHelpers.js`) uses a **capacity model**: the monthly target's denominator is the month's working days excluding holidays; the numerator additionally excludes the attorney's OOO. So firm holidays are treated as already baked into the monthly target (they cancel for a full month, only shifting intra-month pace), while an attorney's OOO proportionally **reduces** their expected target for **any** period — in-progress or completed. A fully-OOO period yields a 0 target (shown as N/A, not 0%).
- **Holiday source of truth**: when `holidays` is present it replaces the federal list. Note `isBusinessDay` independently excludes weekends + federal holidays, so a federal holiday the firm actually works cannot be "un-excluded" while it remains in `isBusinessDay` (accepted limitation). Ensure the synced calendar covers the analyzed date range.
- **Attribution / matching**: the dashboard does **exact, normalized** matching (email first, then name) — there is **no nickname resolution** in the app. Canonicalize the attorney's display name + email in the Apps Script so they match the `users` collection.

### Sync Architecture

```
Shared Google Calendar → Apps Script (syncTimeOff) → Firestore: timeOff/all
                                       │
                                       ├── 1. List all-day events in a window (e.g. −1 .. +12 months)
                                       ├── 2. Classify each event: holiday vs per-person OOO
                                       ├── 3. Expand holidays per-day; attribute OOO to an attorney
                                       │      (canonical name + email)
                                       └── 4. Overwrite the doc (or PATCH holidays / outOfOffice)
```

- **Sync trigger**: time-driven (e.g. twice daily), matching the driveDownloads cadence.
- **Classification**: an event is a **holiday** when its title matches a known holiday-label list (or it has no per-person attendee); otherwise it is **OOO**, attributed by the primary attendee's email (fallback: resolve the attorney name from the title).
- **Gotcha — exclusive end date**: Google Calendar all-day events report an **exclusive** end (`CalendarEventSeries#getAllDayEndDate()` / `event.end.date` is the day *after* the event). **Subtract one day** to get the inclusive `end` stored here, or a one-day PTO will look like zero days.

```javascript
// Sketch (out-of-repo Apps Script). Writes via the Firestore REST API, same
// pattern as the other syncs. Canonicalize name/email to match `users`.
function syncTimeOff() {
  var cal = CalendarApp.getCalendarById('FIRM_CALENDAR_ID');
  var from = new Date(); from.setMonth(from.getMonth() - 1);
  var to   = new Date(); to.setMonth(to.getMonth() + 12);

  var holidays = [];      // [{ date, name }]  — one per day
  var outOfOffice = [];   // [{ name, email, start, end, title }]

  cal.getEvents(from, to).forEach(function (ev) {
    if (!ev.isAllDayEvent()) return;
    var startD = ev.getAllDayStartDate();
    var endD   = ev.getAllDayEndDate();             // EXCLUSIVE
    endD = new Date(endD.getTime() - 24 * 60 * 60 * 1000); // -> inclusive
    var title = ev.getTitle();

    if (isHolidayTitle(title)) {                    // your label list
      for (var d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
        holidays.push({ date: ymd(d), name: title });
      }
    } else {
      var person = resolveAttorney(ev, title);      // -> { name, email } canonical
      if (person) {
        outOfOffice.push({ name: person.name, email: person.email,
                           start: ymd(startD), end: ymd(endD), title: title });
      }
    }
  });

  writeDoc('timeOff/all', {                          // overwrite (or PATCH the two arrays)
    holidays: holidays, outOfOffice: outOfOffice,
    lastSyncedAt: new Date().toISOString(), source: 'Firm Calendar (shared)'
  });
}

function ymd(d) {                                    // PST calendar day
  return Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd');
}
```

- **Cost per sync**: 1 write (plus reads if PATCHing).

---

## Document: `clientAliases/all`

Stores human-confirmed mappings between Mercury transaction counterparty names and invoice client names. Used by the invoice matching feature on `/admin/invoices` to automatically suggest transaction matches for unpaid invoices.

### Document Schema

```javascript
{
  aliases: {
    "gusto": ["Get Sonar, Inc.", "Safebox LLC"],  // one counterparty → multiple clients
    "goodrec": ["Just Play Apps, Inc."],
    "shopsel, inc": ["Cherry-Pick.com, Inc."],
    // key = lowercase counterparty name
    // value = array of invoice client names this counterparty pays for
  }
}
```

### Field Notes

- **Keys** are always lowercase (case-insensitive matching).
- **Values** are arrays of client names exactly as they appear on invoices. A single counterparty can pay for multiple different clients (e.g., "GUSTO" processes payments for several companies).
- The document is created on first alias confirmation and grows as more matches are confirmed.

### How It's Used

1. **On page load**: The invoices page fetches this document alongside invoices and transactions.
2. **Matching algorithm**: For each unpaid invoice, transactions are ranked as candidates:
   - **Alias match** (highest priority): counterparty name (lowercased) exists as a key and the array includes the invoice's client name.
   - **Name match**: case-insensitive substring match between counterparty name and client name.
   - **Amount match**: transaction amount equals invoice amount.
3. **On confirm**: When a human selects and confirms a match, the counterparty→client pair is added to this document (appended to the array if the key exists, or created as a new array entry).

### Data Lifecycle

- **Created by**: Admin user confirming a match on `/admin/invoices`
- **Updated by**: Each subsequent match confirmation (adds to alias arrays)
- **Read by**: Invoice matching logic on `/admin/invoices`
- **Not affected by**: Invoice or transaction syncs (aliases are independent of sync data)

---

## Collection: `transactions/{mercuryId}`

Stores bank transactions synced from Mercury's API. Each document represents a single transaction and uses Mercury's transaction UUID as the Firestore document ID. Data is synced via the `/api/sync-transactions` API route, triggered by the "Sync from Mercury" button on the admin transactions page (`/admin/transactions`).

### Document Schema

```javascript
{
  id: "a1f97ca2-0089-11f1-804c-274d5cc3c97c",  // string — Mercury transaction UUID
  amount: -4300.00,                               // number — negative = expense, positive = payment
  status: "sent",                                  // string — "sent", "pending", "failed", "cancelled"
  createdAt: "2026-02-02T22:50:55.274196Z",       // string — ISO 8601 timestamp
  postedAt: "2026-02-02T22:50:55.297172Z",        // string | null — when the transaction posted
  estimatedDeliveryDate: "2026-02-02T22:50:55Z",  // string | null — estimated delivery
  counterpartyId: "a1f59948-0089-11f1-804c-...",  // string — Mercury counterparty UUID
  counterpartyName: "AMBA Administrat",            // string | null — counterparty display name
  counterpartyNickname: null,                      // string | null — user-assigned nickname
  bankDescription: "AMBA Administrat; debitpmt; Cedar Grove LLP", // string | null
  note: "Rio Finance January 2026",               // string | null — user-added note in Mercury
  externalMemo: "From Cedar Grove LLP via mercury.com", // string | null
  dashboardLink: "https://mercury.com/transactions/...", // string | null — link to Mercury dashboard
  kind: "other",                                   // string — "other", "externalTransfer", etc.
  merchant: null,                                  // object | null — merchant info for card transactions
  mercuryCategory: null,                           // string | null — Mercury's auto-category
  checkNumber: null,                               // string | null — for check transactions
  feeId: null,                                     // string | null — associated fee transaction
  reasonForFailure: null,                          // string | null — failure reason if status is "failed"
  failedAt: null,                                  // string | null — ISO 8601 timestamp of failure
  accountId: "51275c28-043f-11f0-a6df-...",        // string — Mercury account UUID
  details: {},                                     // object — additional transaction details
  compliantWithReceiptPolicy: true,                // boolean
  hasGeneratedReceipt: false,                      // boolean
  attachments: [],                                 // array — receipt/document attachments
  relatedTransactions: [],                         // array — linked transaction IDs
  categoryData: null,                              // object | null — categorization metadata
  trackingNumber: "042000010619411",               // string | null — wire/ACH tracking number
  requestId: null,                                 // string | null — originating request ID
  currencyExchangeInfo: null,                      // object | null — for foreign currency transactions
  creditAccountPeriodId: null                      // string | null — credit account period
}
```

### Sync Architecture

```
Mercury API → Next.js API Route → Firestore
                    │
                    ├── 1. GET /api/v1/account/{accountId}/transactions (paginated, 500 per page)
                    ├── 2. Authenticate with Bearer token (MERCURY_API_TOKEN env var)
                    ├── 3. Collect all transactions across pages
                    └── 4. Batch upsert into transactions/{mercuryId} (500 per batch)
```

- **Sync trigger**: Manual — admin clicks "Sync from Mercury" button on `/admin/transactions`
- **Upsert strategy**: Uses Mercury's `id` as the Firestore document ID. `batch.set()` overwrites the full document, so re-running the sync is safe and idempotent.
- **API route**: `POST /api/sync-transactions` — uses Firebase Admin SDK (server-side only)
- **Environment variables**: `MERCURY_API_TOKEN` (Bearer token), `FIREBASE_SERVICE_ACCOUNT_KEY` (service account JSON)

### Dashboard Usage

| Dashboard View | Data Source |
|---|---|
| Transaction list table | `transactions` collection (all docs) |
| Summary cards (expense/payment totals) | Computed client-side from `amount` field |
| Filter by expenses/payments | `amount < 0` (expenses) or `amount > 0` (payments) |
| Sort by date, amount, status, counterparty | Client-side sorting on fetched documents |

---

## Document: `clients/all`

Stores all client records in a single document as an array. Synced from a Google Sheets Apps Script that reads the firm's client tracking sheet and writes to Firestore.

### Document Schema

```javascript
{
  clients: [
    {
      clientName: "Acme Corp",              // string — client display name (primary identifier)
      status: "Active",                      // string — "Active", "Inactive", etc.
      clientType: "Corporation",             // string — entity type
      channel: "Referral",                   // string — acquisition channel
      contactEmail: "ceo@acme.com",         // string — primary contact email
      website: "https://acme.com",          // string — client website
      elDate: "2025-03-15",                 // string — engagement letter date
      notes: "Annual retainer client",      // string — freeform notes
      isIdeal: true,                         // boolean — LEGACY ideal client flag (no longer
                                             //   surfaced; the UI shows calculated Payment
                                             //   Status tags from invoices/all instead)
      diverseFounder: false,                 // boolean — diverse founder flag
      clientContact: "Jane Smith",          // string — primary contact name
      billingContact: "John Doe",           // string — billing contact name
      billingContactEmail: "billing@acme.com", // string — billing contact email
      phoneNumber: "555-0123",              // string — phone number
      location: "San Francisco, CA",         // string — client location
      paymentTerms: 30                        // number — payment terms in days (15 or 30)
    }
    // ... one object per client
  ],
  lastSyncedAt: "2026-02-18T19:00:00.000Z", // string — ISO 8601 timestamp of last sync
  totalClients: 47                            // number — length of clients array
}
```

### Field Notes

- `clientName` is the primary identifier used throughout the dashboard for lookups and display.
- All fields are optional except `clientName`.
- The dashboard fetches this single document on load and filters/searches the clients array client-side.
- `isIdeal` is legacy: the manual Ideal/Non-Ideal/TBD tags were replaced by Payment Status tags (On Target / Warning / Hold) that are auto-calculated from `invoices/all` + `paymentTerms` (see `src/utils/paymentStatus.mjs`) and refresh on every invoice sync.

### Sync Architecture

- **Sync trigger**: Google Sheets Apps Script (manual or scheduled)
- **Strategy**: Full overwrite — the entire `clients/all` document is replaced on each sync.
- **Cost per sync**: 0 reads, 1 write.

---

## Collection: `matters/{autoId}`

Stores matter records used to populate matter dropdowns in the time-tracking Google Sheets. Each document represents one matter and uses a Firestore auto-generated ID. Managed by a Google Sheets Apps Script — the dashboard reads but does not write to this collection.

### Document Schema

```javascript
{
  name: "YC Application Questions",       // string — matter name
  clientName: "C47 Inc.",                  // string — associated client name
  createdAt: Timestamp,                    // Firestore Timestamp — when the matter was created
  lastUsedAt: Timestamp,                   // Firestore Timestamp — when the matter was last used
  createdBy: "Michael Ohta"               // string — user who created the matter
}
```

### Field Notes

- `name` is the matter name displayed in dropdowns and referenced in billable entries (`entry.matter`).
- `clientName` ties the matter to a client. All billable entries for a given matter should share the same client.
- `lastUsedAt` is updated by the Apps Script when an entry references this matter, allowing stale matters to be identified.

### Sync Architecture

- **Managed by**: Google Sheets Apps Script (creates new matters when users enter a new matter name in the sheet)
- **Dashboard usage**: Read-only — the Matters tab aggregates billable entry data grouped by `entry.matter`, cross-referencing this collection for client names.

---

## Collection: `admins/{email}`

Stores admin role assignments. Document existence determines admin status — there are no fields required on the document itself.

### Schema

```javascript
// Document ID: user's email address (e.g., "michael@cedargrovellp.com")
// Document body: can be empty — existence is the only check
{}
```

### How It's Used

- On login, the dashboard checks `getDoc(doc(db, 'admins', userEmail))`.
- If the document exists, the user is granted admin access (all pages, admin panel).
- If it does not exist, the user is restricted to their own attorney detail page.
- Admin documents are created/deleted manually via the Firebase console or admin UI.

---

## Collection: `driveDownloads/{monthKey}`

Stores Google Drive download events grouped by month. Each document contains all download events for one calendar month across tracked Drive folders. Synced twice daily from Google Drive activity via a Google Apps Script.

### Document ID Format

Month string in `YYYY-MM` format (e.g., `2026-01`, `2026-02`).

### Document Schema

```javascript
{
  month: "2026-02",                          // string — month identifier
  totalDownloads: 87,                        // number — total download events this month
  uniqueUsers: 6,                            // number — distinct users who downloaded
  uniqueFiles: 42,                           // number — distinct files downloaded
  lastUpdated: "2026-02-18T19:00:05.123Z",  // string — ISO 8601 timestamp of last sync

  events: [
    {
      ts: "2026-02-01T09:14:22.000Z",       // string — ISO timestamp of the download
      date: "2026-02-01",                    // string — date only (YYYY-MM-DD, for grouping by day)
      user: "jane@cedargrovellp.com",        // string — email of the user who downloaded
      file: "Engagement Letter - Acme Corp.docx", // string — file name
      type: "document",                      // string — Drive file type ("document", "spreadsheet", "pdf", etc.)
      docId: "1aBcDeFgHiJkLmNoPqRsT",       // string | null — Google Drive file ID
      owner: "john@cedargrovellp.com",       // string | null — email of the file owner
      folder: "Form Documents",              // string — top-level tracked folder label
      folderName: "Retainer Agreements",     // string — immediate parent folder name
      folderPath: "Form Documents/Retainer Agreements" // string — full path from root label to parent folder
    }
    // ... one object per download event
  ]
}
```

### Folder Fields

Each event carries three folder fields that allow the dashboard to filter and group downloads at different levels of granularity:

| Field | Description | Example |
|---|---|---|
| `folder` | Top-level tracked folder label — matches the `label` in `TRACKED_FOLDERS` config. Stable identifier for broad filtering. | `"Form Documents"` |
| `folderName` | Name of the immediate parent folder containing the file. Useful for grouping by subfolder. | `"Retainer Agreements"` |
| `folderPath` | Slash-separated path from the root label down to the file's parent folder. Useful for display and deep filtering. | `"Form Documents/Retainer Agreements"` |

For files sitting directly inside the root tracked folder (no subfolder), all three fields will reference the root label:

```javascript
folder: "Form Documents",
folderName: "Form Documents",
folderPath: "Form Documents"
```

### Excluded Folders

Specific subfolders can be excluded from scanning by adding their Drive folder IDs to the `EXCLUDED_FOLDER_IDS` constant in the sync script. Excluded folders are skipped at any depth and their files will not appear in download events.

### Querying

The dashboard fetches the month documents that span the selected date range, then filters the `events` array client-side by date, `folder`, `folderName`, or `folderPath` as needed.

### Sync Architecture

- **Schedule**: Twice daily (8 AM and 8 PM ET)
- **Scheduled sync window**: 1st of current month → now (overwrites current month doc)
- **Backfill**: Jan 1, 2026 → now (overwrites all month docs in range)
- **Cost per sync**: 0 reads, 1–3 writes (one per month touched)
- **Cost per dashboard load**: 1–3 reads depending on date range

---

## Firestore Indexes

### Required Composite Indexes

None required for the primary dashboard flow. Since each data access reads a single known document by path (e.g., `billables/2026_January`), no query indexes are needed.

### Collection Group Queries

The new schema does **not** use `collectionGroup` queries. All data access is by direct document path. This eliminates the need for collection group indexes and avoids the duplication/stale-data issues that plagued the previous `entries`-based architecture.

---

## Migration from Legacy Schema

### Legacy Schema (Deprecated)

The previous schema stored individual entries as separate documents:

```
users/{userId}/entries/{docId}
```

Where `docId` was `{userId}_{year}_{month}_row{rowNumber}`. This caused:

- **Duplicate documents** from multiple sync runs with different ID patterns
- **Year detection bugs** from parsing date cells instead of spreadsheet names
- **Expensive reads** — the dashboard fetched all entries via `collectionGroup('entries')` and aggregated client-side
- **Stale data** — no cleanup mechanism for orphaned documents

### Migration Steps

1. Deploy the new sync script with the updated schema
2. Run the sync for each user and each month to populate the new collections
3. Verify dashboard reads from the new collections
4. Delete the legacy `entries` subcollections once confirmed