/**
 * E2E smoke suite — 11 user journeys + an axe-core accessibility scan against
 * the emulator-seeded app (scripts/seed-e2e-data.mjs; expected values from
 * tests/e2e/fixtures.mjs, the single source of truth shared with the seed).
 *
 * Run via `npm run test:e2e` (build:e2e + emulators + seed + playwright).
 * `npx playwright test --list` verifies the suite loads without the emulator.
 *
 * Every spec that touches current-month KPIs, date-range filters, or
 * payment-status tags pins the browser clock to E2E_TODAY BEFORE the first
 * navigation — the app computes "today" with the real `new Date()`.
 *
 * Journeys run under the persona-matched Playwright project (chromium-admin /
 * chromium-attorney / chromium-partial, see playwright.config.mjs); each
 * describe block skips itself on the other projects so `--list` shows the
 * full matrix but a run executes each journey exactly once.
 */

import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { E2E_TODAY, EXPECTED, SEED } from './fixtures.mjs';

// Fresh, signed-out context (overrides the project-level storageState).
const NO_AUTH = { cookies: [], origins: [] };

// Displayed wherever a Hold tag renders (utils/paymentStatus.mjs
// HOLD_FLAG_MESSAGE — mirrored here since fixtures.mjs doesn't re-export it).
const HOLD_FLAG_MESSAGE = 'No new matters without partner approval';

// Restrict a describe block to one Playwright project. The suite still lists
// under every project (they all depend on the same auth setup), but only the
// persona the journey is written for actually runs it.
const runOnlyOn = (projectName) => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== projectName, `runs on ${projectName} only`);
  });
};

const pinClock = (page) => page.clock.setFixedTime(new Date(E2E_TODAY));

// The five inline Overview KPI cards (grid grid-cols-2 md:grid-cols-5).
// NOTE: "Total Billable" is a prefix of "Total Billables" — callers pass a
// regex with a lookahead where that matters.
const overviewKpi = (page, labelRe) =>
  page.locator('main div.grid.grid-cols-2 > div').filter({ hasText: labelRe }).first();

const dashboardNav = (page) => page.getByRole('navigation', { name: 'Dashboard sections' });

// ---------------------------------------------------------------------------
// Journey 1 — unauthenticated visitors are redirected to /login.
// ---------------------------------------------------------------------------
test.describe('journey 1: unauthenticated redirect', () => {
  runOnlyOn('chromium-admin');
  test.use({ storageState: NO_AUTH });

  test('visiting / signed out lands on /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/login/);
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey 2 — a plain attorney landing on / is routed to their own detail page.
// ---------------------------------------------------------------------------
test.describe('journey 2: attorney lands on own detail page', () => {
  runOnlyOn('chromium-attorney');

  test('/ redirects Nick Nolan to /users/Nick%20Nolan', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');
    await page.waitForURL(/\/users\/Nick(%20| )Nolan/);
    await expect(page.getByRole('heading', { name: 'Nick Nolan', level: 1 })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey 3 — role-based tab visibility.
// ---------------------------------------------------------------------------
test.describe('journey 3: admin sees every dashboard tab', () => {
  runOnlyOn('chromium-admin');

  test('all tabs incl. admin-only ones are present', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');
    await expect(dashboardNav(page).getByRole('button')).toHaveText([
      'Overview',
      'Team Members',
      'Transactions',
      'Ops',
      'Clients',
      'Targets',
      'Downloads',
      'Practice Composition',
      'Tech Team',
      'Invoices (testing)',
      'Timesheets (testing)',
    ]);
  });
});

test.describe('journey 3b: partial-access user sees only Transactions + Ops', () => {
  runOnlyOn('chromium-partial');

  test('transactions+ops-only dashboard restricts the tab set', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');
    await expect(dashboardNav(page).getByRole('button')).toHaveText(['Transactions', 'Ops']);
  });
});

// ---------------------------------------------------------------------------
// Journey 4 — ?tab= round-trips and aria-current tracks the active tab.
// ---------------------------------------------------------------------------
test.describe('journey 4: tab navigation round-trip', () => {
  runOnlyOn('chromium-admin');

  test('?tab=clients selects Clients; clicking tabs updates URL + aria-current', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?tab=clients');

    const nav = dashboardNav(page);
    await expect(nav.getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('button', { name: 'Team Members' }).click();
    await expect(page).toHaveURL(/tab=attorneys/);
    await expect(nav.getByRole('button', { name: 'Team Members' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: 'Clients' })).not.toHaveAttribute('aria-current', 'page');

    // Overview is the default tab — selecting it drops the param entirely.
    await nav.getByRole('button', { name: 'Overview' }).click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(nav.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Journey 5 — Overview KPIs equal the seeded EXPECTED values.
// The default dashboard range is current-month, so with the clock pinned to
// E2E_TODAY these are the July 2026 numbers. (The "Total Billables" $ card is
// rate × hours at CLIENT rates — a different construction from
// EXPECTED.billableEarnings' take-home semantics — so this journey asserts
// the hour KPIs + Adjustments, which map 1:1 onto EXPECTED.)
// ---------------------------------------------------------------------------
test.describe('journey 5: Overview KPIs match seeded values', () => {
  runOnlyOn('chromium-admin');

  test('current-month hour KPIs + Adjustments equal EXPECTED.overview.currentMonth', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');

    // The Overview's default cohort is "All Lawyers" (role === 'Attorney'),
    // which excludes the seeded Partner (Alex Adams). EXPECTED.overview
    // aggregates ALL seeded users, so switch to the Full Team cohort first.
    await page.getByRole('button', { name: 'Full Team' }).click();

    const cm = EXPECTED.overview.currentMonth;
    await expect(overviewKpi(page, /Total Billable(?!s)/)).toContainText(`${cm.billableHours}h`);
    await expect(overviewKpi(page, /Total Ops/)).toContainText(`${cm.opsHours}h`);
    // Adjustments card only renders when the cohort has adjustment entries —
    // Alex Adams' July +$250 makes it appear for the current month.
    await expect(overviewKpi(page, /Adjustments/)).toContainText(`$${cm.adjustments}`);
  });
});

// ---------------------------------------------------------------------------
// Journey 6 — switching the date range changes the Total Billable KPI to
// precomputed values: Current Month 22h -> All Time 96h -> Trailing 60 69h.
// Trailing-60 derivation (not representable in EXPECTED's monthly buckets):
// window = [2026-05-16 00:00, E2E_TODAY], which drops the three pre-5/16 May
// entries (Alex 10h + 5h, Nick 12h) from the 96h all-time total -> 69h.
// ---------------------------------------------------------------------------
test.describe('journey 6: date-range switch drives Total Billable', () => {
  runOnlyOn('chromium-admin');

  test('Current Month -> All Time -> Trailing 60 Days', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');

    // EXPECTED aggregates all seeded users — switch off the default
    // "All Lawyers" cohort (which excludes the Partner) first.
    await page.getByRole('button', { name: 'Full Team' }).click();

    const billableCard = overviewKpi(page, /Total Billable(?!s)/);
    await expect(billableCard).toContainText(`${EXPECTED.overview.currentMonth.billableHours}h`);

    await page.getByRole('button', { name: 'Current Month' }).click();
    await page.getByRole('button', { name: 'All Time', exact: true }).click();
    await expect(billableCard).toContainText(`${EXPECTED.overview.totals.billableHours}h`);
    await expect(page).toHaveURL(/dateRange=all-time/);

    await page.getByRole('button', { name: 'All Time' }).click();
    await page.getByRole('button', { name: 'Trailing 60 Days', exact: true }).click();
    await expect(billableCard).toContainText('69h');
  });
});

// ---------------------------------------------------------------------------
// Journey 7 — the global attorney filter narrows every Overview figure.
// ---------------------------------------------------------------------------
test.describe('journey 7: global attorney filter narrows KPIs', () => {
  runOnlyOn('chromium-admin');

  test('filtering to Nick Nolan reduces Total Billable to his hours', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?dateRange=all-time');

    // EXPECTED aggregates all seeded users — switch off the default
    // "All Lawyers" cohort (which excludes the Partner) first.
    await page.getByRole('button', { name: 'Full Team' }).click();

    const billableCard = overviewKpi(page, /Total Billable(?!s)/);
    await expect(billableCard).toContainText(`${EXPECTED.overview.totals.billableHours}h`);

    await page.getByRole('button', { name: 'All Team Members' }).click();
    await page.getByRole('checkbox', { name: 'Alex Adams' }).uncheck();
    await page.getByRole('checkbox', { name: 'Valery Vaughn' }).uncheck();
    await page.keyboard.press('Escape');

    await expect(billableCard).toContainText(
      `${EXPECTED.attorneys['Nick Nolan'].totals.billableHours}h`
    );
    // The trigger reflects the single-attorney selection.
    await expect(page.getByRole('button', { name: 'Nick Nolan' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey 8 — attorney detail: Recent Entries table always renders; the
// Adjustments KPI + column appear ONLY for the adjustment-seeded attorney
// (Alex Adams' July +$250), never for Nick Nolan.
// ---------------------------------------------------------------------------
test.describe('journey 8: attorney detail adjustments gating (Alex)', () => {
  runOnlyOn('chromium-admin');

  test('Alex Adams shows Recent Entries + Adjustments KPI and column', async ({ page }) => {
    await pinClock(page);
    await page.goto('/users/Alex%20Adams'); // detail pages default to all-time

    const alex = EXPECTED.attorneys['Alex Adams'];
    // "Included in Earnings" is unique to the Adjustments KPI card.
    const adjustmentsCard = page.locator('div.bg-white').filter({ hasText: 'Included in Earnings' });
    await expect(adjustmentsCard).toContainText(`$${alex.totals.adjustments}`);

    const recent = page.getByRole('table', { name: 'Recent time entries' });
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('columnheader', { name: 'Adjustment' })).toBeVisible();
    await expect(recent.getByRole('link', { name: 'Acme Corp' }).first()).toBeVisible();
  });
});

test.describe('journey 8b: attorney detail without adjustments (Nick)', () => {
  runOnlyOn('chromium-attorney');

  test('Nick Nolan has Recent Entries but no Adjustments KPI or column', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');
    await page.waitForURL(/\/users\/Nick(%20| )Nolan/);

    // Wait for real data first so the absence checks below aren't passing
    // against a still-loading page: Earnings = 42h x $130 take-home = $5,460.
    await expect(page.locator('div.bg-white').filter({ hasText: 'From billable work' }))
      .toContainText('$5,460');

    const recent = page.getByRole('table', { name: 'Recent time entries' });
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('columnheader', { name: 'Adjustment' })).toHaveCount(0);
    await expect(page.getByText('Included in Earnings')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Journey 9 — Billing Summaries: Amount = client rate x hours + adjustment.
// Alex's July Acme Corp entry (4h x $400 + $250 = $1,850) exercises the
// adjustment-inclusive construction, and the Adjustment column appears only
// because the selection has one. NOTE: the seed contains no pure-adjustment
// (0-hour) row, so that variant of the journey is asserted only through the
// formula itself — documented deviation from the journey brief.
// ---------------------------------------------------------------------------
test.describe('journey 9: billing summaries amounts', () => {
  runOnlyOn('chromium-admin');

  test('Acme Corp / July 2026 bill includes the adjustment in Amount', async ({ page }) => {
    await pinClock(page);
    await page.goto('/billing-summaries');

    await page.locator('#bs-month-select').selectOption('2026-07');
    await page.locator('#bs-client-select').selectOption('Acme Corp');

    // Derive the expected amount from the same seed the app was loaded with.
    const alex = SEED.users.find((u) => u.id === 'Alex Adams');
    const entry = alex.billablesDocs['2026-07'].entries.find((e) => e.client === 'Acme Corp');
    const amount = entry.hours * EXPECTED.attorneys['Alex Adams'].clientRate + entry.adjustment;

    await expect(page.getByRole('columnheader', { name: 'Adjustment' })).toBeVisible();
    await expect(page.getByRole('cell', { name: `$${amount.toLocaleString('en-US')}` }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: `$${entry.adjustment}` }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey 10 — Clients tab shows all three calculated payment-status tags,
// including the Hold partner-approval flag. all-time keeps Cobalt/Foxglove
// visible (no July entries -> hidden from the default Active filter under
// current-month).
// ---------------------------------------------------------------------------
test.describe('journey 10: client payment-status tags', () => {
  runOnlyOn('chromium-admin');

  test('On Target / Warning / Hold tags render, Hold carries the flag', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?tab=clients&dateRange=all-time');

    const rowFor = (name) =>
      page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });

    await expect(rowFor(EXPECTED.paymentStatus.onTarget).getByTestId('payment-status-tag'))
      .toHaveText('On Target');
    await expect(rowFor(EXPECTED.paymentStatus.warning).getByTestId('payment-status-tag'))
      .toHaveText('Warning');

    const holdTag = rowFor(EXPECTED.paymentStatus.hold).getByTestId('payment-status-tag');
    await expect(holdTag).toHaveText('Hold');
    await expect(holdTag).toHaveAttribute('title', HOLD_FLAG_MESSAGE);

    // The Hold stat card surfaces the same operational flag as visible text.
    await expect(page.getByText(HOLD_FLAG_MESSAGE)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Journey 11 — table sorting on the Clients table (aria-sort + row order).
// NOTE: no table in the current UI renders pagination controls (the Recent
// Entries table caps at 50 rows without a pager), so the pagination half of
// this journey asserts the full seeded row count renders on one page instead
// — documented deviation from the journey brief.
// ---------------------------------------------------------------------------
test.describe('journey 11: clients table sort', () => {
  runOnlyOn('chromium-admin');

  test('Client Name sort toggles asc/desc and reorders rows', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?tab=clients&dateRange=all-time');

    const table = page.getByRole('table', { name: 'Clients' });
    const rowHeaders = table.locator('tbody th[scope="row"]');
    await expect(rowHeaders).toHaveCount(EXPECTED.clientCount);

    const sortButton = table.getByRole('button', { name: 'Client Name' });
    await sortButton.click();
    await expect(table.getByRole('columnheader', { name: /Client Name/ }))
      .toHaveAttribute('aria-sort', 'ascending');
    await expect(rowHeaders.first()).toHaveText('Acme Corp');

    await sortButton.click();
    await expect(table.getByRole('columnheader', { name: /Client Name/ }))
      .toHaveAttribute('aria-sort', 'descending');
    await expect(rowHeaders.first()).toHaveText('Foxglove LLC');
  });
});

// ---------------------------------------------------------------------------
// Accessibility — axe-core scans of the Overview, an admin page, and /login.
//
// Policy: no NEW critical violations. The allowlists below are the accepted
// baseline per page; they are empty because no critical violations are known
// at authoring time. If a scan fails on a pre-existing issue that won't be
// fixed immediately, snapshot its rule id into the page's allowlist with a
// comment explaining why — never widen an allowlist to admit a regression.
// ---------------------------------------------------------------------------
const A11Y_BASELINE = {
  // (The former 'aria-roles' overview entry — attorney rows' `role` field
  // spread onto bar <path>s by Recharts — was fixed 2026-07 by stripping
  // non-plotted metadata in BillableVsOpsChart's toPlottedRows mapping.)
  overview: [],
  admin: [],
  login: [],
};

async function expectNoNewCriticalViolations(page, allowedIds) {
  const results = await new AxeBuilder({ page }).analyze();
  const fresh = results.violations
    .filter((v) => v.impact === 'critical' && !allowedIds.includes(v.id))
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
  expect(fresh, 'new critical axe violations (add to A11Y_BASELINE only for triaged pre-existing issues)')
    .toEqual([]);
}

test.describe('a11y: axe scans', () => {
  test.describe('authenticated pages', () => {
    runOnlyOn('chromium-admin');

    test('Overview has no new critical violations', async ({ page }) => {
      await pinClock(page);
      await page.goto('/');
      await expect(overviewKpi(page, /Total Billable(?!s)/)).toBeVisible();
      await expectNoNewCriticalViolations(page, A11Y_BASELINE.overview);
    });

    test('Admin panel has no new critical violations', async ({ page }) => {
      await pinClock(page);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible();
      await expectNoNewCriticalViolations(page, A11Y_BASELINE.admin);
    });
  });

  test.describe('login page', () => {
    runOnlyOn('chromium-admin');
    test.use({ storageState: NO_AUTH });

    test('Login has no new critical violations', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
      await expectNoNewCriticalViolations(page, A11Y_BASELINE.login);
    });
  });
});
