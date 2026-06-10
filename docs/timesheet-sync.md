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
