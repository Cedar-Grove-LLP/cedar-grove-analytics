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
│   ├── shared/             # Reusable UI (KPICard, dropdowns, filters)
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
    ├── constants.js        # Colors, date range options, periods
    ├── dateHelpers.js      # Business day math, US holidays
    ├── formatters.js       # Currency and number formatting
    ├── hiddenAttorneys.js  # Attorneys hidden from UI after a date
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
users/{userId}/         — { name, role, email, employmentType, active,
                              rates:   [{ rate, month, year }],
                              targets: [{ month, year, billableHours, opsHours, totalHours, earnings }] }
                           `active` (bool, default true when absent): toggled in the
                           User Management → Role Management admin tab. Inactive
                           attorneys are hidden from dropdowns/rows EXCEPT when the
                           selected timeframe overlaps their actual billable/ops
                           entries (auto-derived, no tenure dates), and are excluded
                           from forward-looking Targets + Projected Earnings. Layered
                           on top of the legacy hiddenAttorneys.js date config.
  billables/{monthDocId}  — { month, year, entries: [{ date, client, matter, hours,
                                                       earnings, billingCategory,
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
                                  syncedAt }],
                                entryCount, lastSyncedAt }
                              Synced manually from the monthly sheet tab via Apps Script
                              (cell B10 "Revenue Accrued" + the "Attorney Billables" line).
                              attorneyBillables is shown on the Billing Summaries page and
                              drives the Overview "Total Billables" KPI (see
                              utils/billingSummary.js).

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

- **Date filtering:** All-time, current month, trailing 60 days, or custom range. Filters applied in `useAnalyticsData`.
- **Attorney filtering:** Global filter dropdown affects all views; some views have additional local filters.
- **Target pro-rating:** Utilization targets are pro-rated per month via a capacity model (`getMonthProRateFraction` in `dateHelpers.js`) using **fractional working days**: each business day contributes `1 − its OOO off-fraction` (normal = 1, half-day OOO = 0.5, full-day OOO = 0), with firm holidays excluded entirely. Denominator = fractional working days in the whole month; numerator = fractional working days in the effective window. OOO and holidays are excluded from **both**, so the policy is **compress, don't reduce**: OOO does not lower an attorney's monthly target total — it spreads the same target across only the days they actually work (`target ÷ working-day capacity`). A full clean month yields exactly 1; a part-time/heavily-OOO attorney paces against their real capacity, not the full calendar month; a fully-OOO period yields 0 → utilization shows N/A. **Partial days:** the calendar enters all OOO as all-day events, so half-day time off is detected by parsing the event title (`parseOooDayFraction` in `utils/timeOff.js`: "Half day", "2PM onwards", "AM only", …) → 0.5 off. OOO/holidays are sourced from `timeOff/all`, falling back to US federal holidays when unsynced. Use the **Time-Off Debug** admin page (`/admin/timeoff-debug`) to inspect per-attorney OOO matching, half-day parsing, and unclassified entries.
- **Hidden attorneys:** Configured in `hiddenAttorneys.js` with date thresholds. Hidden from UI but included in aggregate totals.
- **Role overrides:** `roles.js` maps non-attorney staff to custom display roles.
- **Earnings predictions:** Use `rateCard/all` only for forward projections. Derive an attorney's current rank by exact-matching their latest stored `billableRate` against `rateCard.levels[].clientRate`. For each projected month, bump rank by 1 at every Q2 (Apr 1) and Q4 (Oct 1) boundary, capped at rank 19. If the current rate has no exact match, warn and project a flat `currentRate` for the full horizon (no rank bumps).

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

No test framework is configured. There are no test files.

## Deployment

Configured for Vercel. Push to `main` triggers deploy. Environment variables set in Vercel dashboard.

## Conventions

- JSX components use `.jsx` extension; plain JS uses `.js`.
- Tailwind utility classes for all styling. Custom brand colors defined in `tailwind.config.js` (`cg-black`, `cg-green`, `cg-dark`, `cg-background`).
- Recharts for standard charts; D3 for the ops sunburst visualization.
- Tables include client-side sorting and pagination.
- Currency formatted via `Intl.NumberFormat` helpers in `formatters.js`.
