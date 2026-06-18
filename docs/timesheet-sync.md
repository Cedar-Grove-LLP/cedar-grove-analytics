# Timesheet Sync: Canonical User IDs, Resync & Rate Backfill Runbook

This documents the **out-of-repo** Apps Script sync changes and the
**human-run** data-repair sequence for the Jan–Mar 2025 undercounting
incident (invisible timesheets for Michael Ohta, Valery Uscanga, and PTE
attorneys; `$0` Total Billables). None of these steps are performed by CI or
by code in this repo — they require production credentials and a human
operator.

> The Apps Script project lives outside this repository (`appscript/` is
> gitignored and not present here). Apply the changes below in the Apps
> Script editor attached to the timesheet workbooks.

## 1. Root cause recap

The dashboard (`src/context/FirestoreDataContext.js`) discovers timesheet
data by listing `collection('users')` and reading
`users/{docId}/billables|ops|eightThreeB`. **Any month doc written under a
user ID that is not an existing `users/{docId}` document is invisible** — no
error, no warning, the hours simply never load. Historically the sync derived
user IDs from sheet/tab names (last names, aliases, emails), which orphaned
entire attorneys' histories.

Separately, billing rates live in the `users/{docId}.rates[]` array and the
app's rate lookup falls back **backward only**: an attorney whose `rates[]`
starts in 2026 bills at `$0` for every 2025 entry. The dashboard now shows an
admin warning banner when this happens, but the fix is backfilling the rates
(step 7 below).

## 2. Canonical write paths

All timesheet data must land under the **canonical full-name doc IDs** — the
exact IDs created by Admin → User Management → Add User
(`setDoc(doc(db, 'users', name))`):

> Michael Ohta, Valery Uscanga, Colin van Loon, Sam McClure, David Popkin,
> Nick Agate, Paige Wilson

Paths and doc shape:

```
users/{canonicalFullName}/billables/{year}_{MonthName}    e.g. 2025_January
users/{canonicalFullName}/ops/{year}_{MonthName}
users/{canonicalFullName}/eightThreeB/{year}_{MonthName}

{ month: "January", year: 2025, entries: [...], sheetTotals: {...}, syncedAt }
```

Never derive new user IDs from sheet names. If a workbook/tab name doesn't
exactly match a configured user, the sync must **fail loudly**, not invent an
ID.

## 3. Required Apps Script config

Replace any name-derivation logic with an explicit source list:

```js
const TIMESHEET_SOURCES = [
  {
    userId: "Michael Ohta",            // MUST equal the users/{docId} in Firestore
    spreadsheetId: "1AbC...",
    aliases: ["Ohta", "M. Ohta", "michael ohta"],  // detect/refuse legacy tabs only
    active: true,
    employmentType: "FTE",             // "FTE" | "PTE"
  },
  {
    userId: "Valery Uscanga",
    spreadsheetId: "1DeF...",
    aliases: ["Uscanga", "Valery"],
    active: true,
    employmentType: "PTE",
  },
  // ... one entry per FTE AND PTE attorney workbook — every attorney with a
  // timesheet must appear here, including all PTE attorneys.
];
```

Sync behavior requirements:

1. Write **only** to `users/{source.userId}/billables|ops|eightThreeB`.
2. `aliases` are for detecting legacy/mis-labeled tabs so the operator can be
   warned — never for choosing a write path.
3. On each run, also `set({ employmentType }, { merge: true })` on the user
   doc. (The app reads a **missing** `employmentType` as `"FTE"`, so PTE
   attorneys with no explicit field are silently miscounted into the FTE
   cohort.)
4. If `users/{source.userId}` does not exist, abort that source with an error
   (create the user via the admin UI first).

## 4. Backfill scope

Re-run the sync for **January 2025 → present** for Michael Ohta, Valery
Uscanga, and every PTE attorney — preferably for all attorneys, all of
2025–2026. The sync's delete-and-replace per month doc makes re-runs
idempotent on the canonical paths.

Also backfill `monthlyMetrics/all` entries (`{ month, year, revenueAccrued,
attorneyBillables }`) for any 2025 months the monthly sheet covers — these
drive the Overview "Total Billables" KPI for month-aligned ranges.

## 5. ⚠️ Sequencing: fix the sync BEFORE migrating

The sync **delete-and-replaces** month docs under whatever user ID it is
configured with. If you migrate orphaned docs to canonical IDs while the sync
still targets the old IDs, the next sync run **recreates the orphans** and
the migrated copies go stale. Therefore: reconfigure the sync (section 3)
before — or in the same maintenance window as — any migration run.

## 6. Repair runbook (human-run, in order)

The scripts load credentials from `.env.local` (gitignored):
`FIREBASE_SERVICE_ACCOUNT_KEY='{...service account JSON...}'`, or export
`GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`. The Admin SDK bypasses
security rules — run only from a trusted machine. **Never store production
credentials in a cloud/CI session.**

| # | Step | Why this order |
|---|------|----------------|
| 1 | `node scripts/audit-timesheet-coverage.mjs --out audit-report.json` | Read-only baseline; produces the orphan list, missing-month list, and missing-rate worklist everything below consumes. Zero risk. |
| 2 | Reconfigure the Apps Script sync (section 3) | Must precede any data movement — see section 5. |
| 3 | Resync Jan 2025 → present from the sheets | Preferred repair: sheets are the source of truth and the sync writes fresh canonical docs. Often makes migration unnecessary. |
| 4 | For months no longer in any sheet: copy `suggestedMigrationMap` from `audit-report.json` into `migration-map.json`, review **every** pair by hand, then `node scripts/migrate-timesheet-user-ids.mjs --map migration-map.json` (dry run) | Migration only covers data the resync can't recreate. Dry run first, always. |
| 5 | Review the dry-run output, then re-run with `--write` | Conflicts (target month doc exists and differs) are skipped with a warning — resolve those manually or prefer resync. |
| 6 | Re-run the audit; when targets verify clean, re-run migration with `--write --delete-source` | Source docs are deleted only after the canonical copies are verified. Deletion is a separate, last step by design. |
| 7 | Backfill 2025 rates from the `missingRates` array in `audit-report.json` via Admin → User Management (rates editor), and set explicit `employmentType` on every PTE user | Until rates exist, those hours bill at $0 — the Overview banner will keep flagging them. |
| 8 | Final `node scripts/audit-timesheet-coverage.mjs` — every user `OK` — then verify the dashboard (below) | Confirms the data side; the code side was verified at PR time. |

## 7. Dashboard acceptance checks (after the runbook)

With custom range **Jan 1 – Mar 12, 2025**:

- Michael Ohta and Valery Uscanga appear in the Billable vs Ops chart with
  their sheet hours.
- The **PTE Lawyers** cohort shows nonzero billable/ops time; **All Lawyers**
  totals = FTE + PTE.
- **Total Billables** is nonzero (Rate × Hours subtitle — this range is not
  month-aligned, so the sheet figure is intentionally not used).
- The admin missing-rate banner is gone (no attorney bills at $0).

## 8. Adding the "Adjustment ($)" column to McClure's timesheet (current layout)

Sam McClure needs to adjust a client's **final bill** at month-end without
logging time (logging fake hours distorts every hours metric). His workbook
gains a manual **"Adjustment ($)"** column; this section is the Apps Script side
of that change. **Scope: the McClure workbook only** — other attorneys'
workbooks and all legacy (row-9) tabs are unchanged, so the parser must treat
the column as optional.

### 8.1 Sheet change (done by hand in the workbook — recap)

In the current-layout tabs (header **row 11**) and the **Template** tab:

- A column is **inserted at D**, so:
  - **D** = `Adjustment ($)` — manual input, blank/0 by default, accepts
    positive (extra charge) and negative (credit/discount) values.
  - **E** = `Billables Earnings`, now `= Hours × Rate + Adjustment`
    (`E12 = C12*$B$2 + D12`, filled down).
  - Everything from the old column D rightward shifts **+1** (Billing Category
    E→F, Matter F→G, … ops Hours **M→N**, Reimbursement Amount T→U).
- A pure month-end adjustment is a row with **client + date, 0 hours, and the
  amount in D** → that row's E = `0 × Rate + Adjustment`.
- Hours (C) and `Total Billable Hours` (B1 `=sum(C:C)`) are untouched; the
  `Billable Earnings` (B3) and `Total Payment` (B8) summary cells already sum
  column E, so they include adjustments automatically.

### 8.2 Apps Script: resolve billable columns by header name (recommended)

The insert shifts the fixed column letters the parser relies on, and the column
exists in only one workbook. The robust fix is to **resolve the billable-block
columns by matching the header row** (row 11 in current-layout tabs, row 9 in
legacy) instead of hard-coding letters:

```js
// Build { headerLabel(lowercased) -> 0-based column index } from the header row.
function billableColumnMap(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h).trim().toLowerCase();
    if (key) map[key] = i; // 0-based
  });
  return map;
}

// Resolve with fallbacks; returns -1 when the column is absent.
function col(map, ...labels) {
  for (const l of labels) {
    const k = l.trim().toLowerCase();
    if (k in map) return map[k];
  }
  return -1;
}

const m = billableColumnMap(sheet, headerRow);
const cClient   = col(m, 'Client');
const cDate     = col(m, 'Date');                          // first "Date" = billable date
const cHours    = col(m, 'Hours');                         // first "Hours" = billable hours
const cAdjust   = col(m, 'Adjustment ($)', 'Adjustment');  // -1 on non-McClure / legacy tabs
const cEarnings = col(m, 'Billables Earnings', 'Billable Earnings');
const cCategory = col(m, 'Billing Category');
const cMatter   = col(m, 'Matter');
const cNotes    = col(m, 'Notes');
// Ops / 83(b) / Reimbursement blocks resolve the same way (their "Date"/"Hours"
// are the 2nd occurrences — index from the "Ops" column rightward).
```

This makes the parser immune to the +1 shift and needs **no per-workbook
special-casing**.

### 8.3 Per-entry fields

For each billable row, read and write a new `adjustment` field alongside the
existing `earnings`:

```js
const adjustment = cAdjust >= 0 ? (parseMoney(row[cAdjust]) || 0) : 0;
const earnings   = parseMoney(row[cEarnings]) || 0; // already = Hours×Rate + Adjustment

entry.earnings   = earnings;    // unchanged source column (now col E); includes the adjustment
entry.adjustment = adjustment;  // NEW — raw adjustment, for dashboard transparency
```

- `earnings` keeps coming from the **Billables Earnings** column (now E); because
  the sheet formula folds the adjustment in, **do not add it again**.
- `adjustment` defaults to **0** when the column is absent (other attorneys,
  legacy tabs).

### 8.4 Summary totals (`sheetTotals`)

Read summary values by scanning **column-A labels** in rows 1–8 and taking the
adjacent column-B value, rather than hard-coding B2/B3 — this is layout-proof:

- `billableEarnings` (label `Billable Earnings`) and `totalPayment` (label
  `Total Payment`) already include adjustments (they sum / derive from column E),
  so **no formula change** — just read the right labels.
- Add **`sheetTotals.adjustment`** = `Σ` of the `Adjustment ($)` column (0 when
  the column is absent).

`totalBillableHours` (label `Total Billable Hours`, `=sum(C:C)`) is untouched.

### 8.5 Row inclusion & scope

- Keep the existing rule: include a row if it has **client, billable date, or
  billable hours**. A 0-hour adjustment row carries client + date, so it is
  included and its `earnings` (= the adjustment) syncs.
- Hours parsing is unchanged, so no hours metric moves.
- Applies to the McClure workbook only; everywhere else `adjustment` is 0 and
  nothing changes.

### 8.6 Fixed-index fallback (only if you keep hard-coded columns)

If the parser must stay index-based, apply this **+1 shift to McClure's
current-layout tabs only** (1-based columns):

| Field | Old | New |
|------|-----|-----|
| Adjustment ($) (NEW) | — | D (4) |
| Billables Earnings | D (4) | E (5) |
| Billing Category | E (5) | F (6) |
| Matter | F (6) | G (7) |
| Client Filing Fees | G (7) | H (8) |
| Notes | H (8) | I (9) |
| Ops (description) | J (10) | K (11) |
| Ops Category | K (11) | L (12) |
| Ops Date | L (12) | M (13) |
| Ops Hours | M (13) | N (14) |
| Company / Name / Flat Fee | O/P/Q | P/Q/R |
| Reimb. Desc / Amount | S/T | T/U |

The header-detection approach (§8.2) is preferred because it needs no
per-workbook branching.

### 8.7 Verify

Re-sync one McClure month that has an adjustment row, then on his attorney
detail page confirm: **Earnings** reflects `Hours×Rate + Adjustment`, the
**Adjustments** KPI shows the net (red when negative), the Recent Entries
**Adjustment** column shows the per-row ±, and hours / utilization are unchanged.
Other attorneys show no Adjustments card.
