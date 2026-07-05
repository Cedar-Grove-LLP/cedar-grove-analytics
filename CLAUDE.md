# CLAUDE.md — Cedar Grove Analytics

## Project Overview

Legal analytics dashboard for Cedar Grove LLP. Tracks attorney billable/ops hours, utilization targets, client activity, and billing summaries. Built with Next.js App Router and Firebase (Firestore + Auth).

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19
- **Styling:** Tailwind CSS 4
- **Backend:** Firebase 12 (Firestore, Authentication)
- **Charts:** Recharts 3, D3 7
- **Icons:** Lucide React
- **Linting:** ESLint 9 with next/core-web-vitals

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Production server
npm run lint     # Run ESLint
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── layout.js           # Root layout (wraps AuthProvider)
│   ├── page.js             # Dashboard home
│   ├── login/              # Google Sign-in page
│   ├── attorneys/[attorneyName]/  # Attorney detail (dynamic route)
│   ├── clients/[clientName]/      # Client detail (dynamic route)
│   ├── billing-summaries/         # Billing summaries report
│   └── admin/              # Admin section (targets, users)
├── components/
│   ├── AnalyticsDashboard.jsx  # Main dashboard with tab navigation
│   ├── ProtectedRoute.js       # Auth guard wrapper
│   ├── AdminDashboard.jsx      # Admin panel
│   ├── charts/             # Recharts/D3 visualizations
│   ├── tables/             # Data tables with sorting/pagination
│   ├── views/              # Full-page view components
│   ├── shared/             # Reusable UI (KPICard, CalcTooltip, dropdowns, filters)
│   └── tooltips/           # Custom chart tooltip components
├── context/
│   └── AuthContext.js      # Auth state, Google Sign-in, admin check
├── firebase/
│   └── config.js           # Firebase app initialization
├── hooks/
│   ├── useFirestoreData.js # Firestore collection fetching
│   ├── useAnalyticsData.js # Data aggregation and KPI calculations
│   └── useAttorneyRates.js # Attorney billing rate lookups
└── utils/
    ├── calcDefinitions.mjs # Metric formula/provenance registry (drives CalcTooltip)
    ├── cohortFilter.mjs    # Overview cohort classification (pure, tested)
    ├── commitTimeline.mjs  # Tech Team commit classifier + timeline grouping (pure, tested)
    ├── constants.js        # Colors, date range options, periods
    ├── dateHelpers.js      # Business day math, US holidays
    ├── exportTimelineImage.js # Browser-only SVG/PNG export helpers for the Tech Team chevron timeline (not tested — browser-coupled, see Testing)
    ├── formatters.js       # Currency and number formatting
    ├── hiddenAttorneys.mjs # Attorneys hidden from UI after a date (pure, Node-importable)
    ├── paymentStatus.mjs   # Calculated client Payment Status tags — On Target/Warning/Hold (pure, tested)
    ├── rateLookup.mjs      # Pure billing-rate lookup (backward fallback, tested)
    └── roles.js            # Role overrides for non-attorney staff
```

## Architecture Notes

- **All interactive components use `"use client"`** — server components are only used for route entry points.
- **State management** is React Context (AuthContext) + local `useState`/`useMemo`. No Redux/Zustand.
- **Data fetching** happens in custom hooks (`useFirestoreData.js`, `useAnalyticsData.js`) via Firestore SDK. No REST API layer.
- **Path alias:** `@/*` maps to `./src/*` (configured in `jsconfig.json`).
- **Component barrel exports:** `charts/index.js`, `tables/index.js`, `views/index.js`, `shared/index.js`, `tooltips/index.js`.

## Firestore Data Model

```
users/{userId}/         — { name, role, email, employmentType, active, activationDate,
                              rates:   [{ rate, takeHomeRate?, month, year }],
                              targets: [{ month, year, billableHours, opsHours, totalHours, earnings }] }
                           `active` (bool, default true when absent): toggled in the
                           User Management → Role Management admin tab. Inactive
                           attorneys are hidden from dropdowns/rows EXCEPT when the
                           selected timeframe overlaps their actual billable/ops
                           entries (auto-derived), and are excluded from
                           forward-looking Targets + Projected Earnings. Layered on
                           top of the legacy hiddenAttorneys.mjs date config.
                           `activationDate` (optional "YYYY-MM", tenure-start month —
                           set via <input type="month">; no day-of-month precision
                           since nothing pro-rates a partial month of tenure):
                           set in the same Role Management tab. Drives
                           `hasJoinedBy` (src/utils/userActivation.mjs, also accepts
                           a legacy "YYYY-MM-DD" defensively) — attorneys are hidden
                           from dropdowns/rows/year-scoped admin views (same
                           data-overlap exception as `active`) for any timeframe
                           ending before their activation month, and it floors the
                           custom date-range picker (at the 1st of that month) on
                           their own user page so an out-of-tenure range can't be
                           selected. Absent = no restriction (back-compat for
                           existing users).
  billables/{monthDocId}  — { month, year, entries: [{ date, client, matter, hours,
                                                       earnings, adjustment,
                                                       billingCategory,
                                                       reimbursements, notes,
                                                       sheetRowNumber }],
                              sheetTotals }
  ops/{monthDocId}        — { month, year, entries: [{ date, description, hours,
                                                       category, sheetRowNumber }],
                              sheetTotals }
  eightThreeB/{monthDocId}— { month, year, entries: [{ ..., flatFee }] }

  NOTE: legacy `attorneys/{name}/...` collection is deprecated. All
        attorney profile data, rates, targets, and time entries live
        under `users/{userId}` (subcollections for entries, arrays
        for rates/targets).

clients/all             — { clients: [array of client objects], lastSyncedAt, totalClients }
                           Each client: clientName, status, clientType, channel, contactEmail,
                           website, elDate, notes, isIdeal, diverseFounder, clientContact,
                           billingContact, billingContactEmail, phoneNumber, location,
                           paymentTerms (number, 15 or 30)
                           NOTE: `isIdeal` is legacy — the manual Ideal/Non-Ideal/TBD tags
                           were replaced by calculated Payment Status tags (see Key
                           Patterns) and the field is no longer surfaced in the UI.

invoices/all            — all client invoices in a single doc, synced from the Invoices
                           workbook's "Payment Status" sheet tab (source of truth):
                           { entryCount, syncedAt, entries: [{ client, amount, year,
                               dateSent, status ("Paid"|"Not Paid"|"Payment Initiated"),
                               lastReminder, dateReceived, notes, sheetRowNumber }] }
                           Drives the calculated client Payment Status tags
                           (utils/paymentStatus.mjs) and the admin Billing KPIs /
                           invoice-matching pages.

matters/{autoId}         — name, clientName, createdAt, lastUsedAt, createdBy
                           (managed by Google Sheets Apps Script for matter dropdowns)

admins/{email}          — document existence = admin role

transactions/{mercuryId} — id, amount, status, postedAt, createdAt, estimatedDeliveryDate,
                           counterpartyId, counterpartyName, counterpartyNickname,
                           bankDescription, note, externalMemo, dashboardLink,
                           kind, merchant, mercuryCategory, checkNumber,
                           reasonForFailure, failedAt, accountId
                           (synced from Mercury API via /api/sync-transactions)

driveDownloads/{monthKey}  — month, totalDownloads, uniqueUsers, uniqueFiles, lastUpdated,
                              events: [{ ts, date, user, file, type, docId, owner, folder }]
                              One doc per month (e.g. "2026-02"). Synced twice daily from
                              Google Drive activity across 5 tracked folders:
                              Administrative, Attorney Employment, Engagements,
                              Legal Memos, New Client Onboarding.

monthlyMetrics/all       — firm-wide per-month metrics. Single doc with entries[] array:
                              { entries: [{ month, year, revenueAccrued,
                                  attorneyBillables,  // optional; pulled from the sheet
                                  firmProfit,         // optional; invoices sheet cell B16
                                  syncedAt }],
                                entryCount, lastSyncedAt }
                              Synced manually from the monthly sheet tab via Apps Script
                              (cell B10 "Revenue Accrued" + the "Attorney Billables" line).
                              attorneyBillables is shown on the Billing Summaries page and
                              drives the Overview "Total Billables" KPI (see
                              utils/billingSummary.js). firmProfit (invoices workbook B16)
                              is optional — absent until the sync ships; drives the partner
                              profit-share column on the Projected Earnings admin page.

rateCard/all             — shared rate ladder used ONLY for predictive earnings
                              modeling. Single doc:
                              { levels: [{ rank, level, tier, clientRate,
                                           attorneyRate, colinRate,
                                           estAnnualSalary, cravathTotalComp }],
                                notes, source, year, lastSyncedAt }
                              20 entries, rank 0-19 (A1/A → P2/B). Seeded by
                              scripts/seed-rate-card.js. Historical billing
                              continues to use attorneys/{name}/rates — rate
                              card is forward-looking only.

timeOff/all              — firm out-of-office + holidays, single doc:
                              { holidays:    [{ date: "YYYY-MM-DD", name }],
                                outOfOffice: [{ name, email, start, end, title }],
                                lastSyncedAt, source }
                              Synced from the shared firm Google Calendar via Apps
                              Script (out-of-repo). `holidays` is one entry per day;
                              `outOfOffice` ranges are inclusive. Consumed read-only
                              to OOO/holiday-adjust utilization targets (see
                              utils/timeOff.js + dateHelpers `getMonthProRateFraction`).
                              Optional — absent until the sync ships (federal-holiday
                              fallback, no OOO).
```

Legacy field names (`hours`, `secondaryHours`) are normalized to `billableHours`/`opsHours` in hooks.

## Auth & Authorization

- Google OAuth via Firebase `signInWithPopup`.
- Domain-restricted: `@cedargrovellp.com` emails are authorized.
- Admin role: determined by document in `admins` collection.
- Non-admin users are redirected to their own attorney detail page.
- Nickname mapping (e.g., "Nick" → "Nicholas") handles attorney page access matching.

## Key Patterns

- **Calculation tooltips:** Every user-visible calculated value carries a hover/focus tooltip explaining its formula, inputs, and provenance — including the source workbook/tab/cell (both sheet layout families) for values synced from Google Sheets. `src/utils/calcDefinitions.mjs` is the **single source of truth** (validated by `tests/calc-definitions.test.mjs`); UI attaches via `shared/CalcTooltip.jsx` (`calcKey` prop, or `info={{ calcKey }}` on KPICard/ClientStatCard) and the `sourceNote` line in chart tooltips. **Any new calculated display must reference a registry key** — add the key to the registry (and `REQUIRED_KEYS` coverage follows automatically) rather than hardcoding tooltip text. Tables get one tooltip per computed column header, not per cell.
- **Date filtering:** All-time, current month, trailing 60 days, or custom range. Filters applied in `useAnalyticsData`.
- **Attorney filtering:** Global filter dropdown affects all views; some views have additional local filters.
- **Target pro-rating:** Utilization targets are pro-rated per month via a capacity model (`getMonthProRateFraction` in `dateHelpers.js`) using **fractional working days**: each business day contributes `1 − its OOO off-fraction` (normal = 1, half-day OOO = 0.5, full-day OOO = 0), with firm holidays excluded entirely. Denominator = fractional working days in the whole month; numerator = fractional working days in the effective window. OOO and holidays are excluded from **both**, so the policy is **compress, don't reduce**: OOO does not lower an attorney's monthly target total — it spreads the same target across only the days they actually work (`target ÷ working-day capacity`). A full clean month yields exactly 1; a part-time/heavily-OOO attorney paces against their real capacity, not the full calendar month; a fully-OOO period yields 0 → utilization shows N/A. **Partial days:** the calendar enters all OOO as all-day events, so half-day time off is detected by parsing the event title (`parseOooDayFraction` in `utils/timeOff.js`: "Half day", "2PM onwards", "AM only", …) → 0.5 off. OOO/holidays are sourced from `timeOff/all`, falling back to US federal holidays when unsynced. Use the **Time-Off Debug** admin page (`/admin/timeoff-debug`) to inspect per-attorney OOO matching, half-day parsing, and unclassified entries.
- **Client Payment Status tags:** Clients carry an auto-calculated **On Target / Warning / Hold** tag (replacing the old manual Ideal/Non-Ideal/TBD ideal-fit tags). `src/utils/paymentStatus.mjs` (pure, tested by `tests/payment-status.test.mjs`) derives the tag from the synced `invoices/all` rows + the client's `paymentTerms`, so it refreshes whenever the Payment Status sheet re-syncs — **never set manually**. Criteria: On Target = avg payment ≤ 15d AND ≥90% of invoices paid within 15d AND 0 outstanding; Hold = 2+ invoices overdue at once OR 1 invoice 30+ days past terms OR avg > 30d (displays the "No new matters without partner approval" flag); Warning = avg 22–30d, 1 invoice 21+ days overdue, or 2 unpaid accumulated — implemented as the middle catch-all so the three tags cover the whole book. **Hold exit is sticky:** the invoice history is replayed per calendar-month billing cycle; leaving Hold requires zero balance + 2 consecutive clean cycles and steps down to Warning first, never straight to On Target.
- **Manual bill adjustments (McClure only):** Sam McClure's timesheet has an **Adjustment ($)** column (current-layout col D) for month-end charges (+) / credits (−) to a client's final bill **without logging time**. It is folded into **Billables Earnings** (col E = `Hours × Rate + Adjustment`), so synced `earnings` already includes it while hours columns and `Total Billable Hours` stay untouched. The dashboard normalizes a per-entry `adjustment` field (defaults to 0; absent on other attorneys and legacy tabs) and surfaces an **Adjustments** KPI + a Recent Entries column on the attorney detail page — it is informational only, **never added on top of `earnings`** (already inside). Calc keys: `adjustment`, `entryAdjustment`. Apps Script steps: `docs/timesheet-sync.md`.
- **Hidden attorneys:** Configured in `hiddenAttorneys.mjs` with date thresholds. Hidden from UI but included in aggregate totals.
- **Role overrides:** `roles.js` maps non-attorney staff to custom display roles.
- **Earnings predictions:** Use `rateCard/all` only for forward projections. Derive an attorney's current rank by exact-matching their latest stored rate (a **client** billing rate) against `rateCard.levels[].clientRate`. For each projected month, bump rank by 1 at every Q2 (Apr 1) and Q4 (Oct 1) boundary, capped at rank 19. Projected earnings pay out the **take-home** column for the predicted rank — `attorneyRate`, or `colinRate` for Colin (null below rank 13 → falls back to `attorneyRate`) — never the client rate. If the current rate has no exact match, warn ("No rank match" badge) and project $0 take-home (unknowable without a rank). **Part-time (PTE) attorneys** skip the rate card entirely — their stored rate is held flat for the whole year (no Q2/Q4 bumps); the Projected Earnings page also exposes a per-attorney **Promote** checkbox to toggle their rank bumps on/off. **Partner profit share:** the two partners (Sam McClure 95%, Colin Van Loon 5%) additionally receive a share of the predicted full-year firm profit — `avg(completed-month firmProfit) × 12 × share%` — surfaced in a Profit Share column and folded into their Proj. Earnings total.

## Environment Variables

All prefixed with `NEXT_PUBLIC_` (client-side accessible):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Set in `.env.local` (gitignored).

## Testing

`npm test` runs Node's built-in test runner (`node --test tests/*.test.mjs`) — no test framework dependency. Tests cover the pure `.mjs` modules only (rate lookup, cohort filter, payment status tags, calc-definitions registry + call-site key coverage, audit script helpers, Tech Team commit classifier/timeline grouping); React components and hooks are not unit-tested (they import the Firebase client SDK at module load). Run the suite whenever touching `src/utils/*.mjs`, `scripts/`, or registry keys.

## Deployment

Configured for Vercel. Push to `main` triggers deploy. Environment variables set in Vercel dashboard.

## Conventions

- JSX components use `.jsx` extension; plain JS uses `.js`.
- Tailwind utility classes for all styling. Custom brand colors defined in `tailwind.config.js` (`cg-black`, `cg-green`, `cg-dark`, `cg-background`).
- Recharts for standard charts (bar/line/pie/area — anything with data-driven axes/scales); D3 for the ops sunburst visualization. Bespoke annotated infographics that aren't a standard chart type (e.g. `TechTeamChevronTimeline.jsx`'s chevron/callout timeline) use hand-built inline-styled SVG instead — neither library models that layout naturally, and the component still imports its colors from `utils/colors.js` (GRAY) rather than hardcoding hex.
- Tables include client-side sorting and pagination.
- Currency formatted via `Intl.NumberFormat` helpers in `formatters.js`.
