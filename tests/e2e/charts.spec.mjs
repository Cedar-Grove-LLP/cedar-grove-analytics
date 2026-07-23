/**
 * Structural chart assertions against the seeded emulator dataset.
 *
 * Verifies that Recharts SVG output matches the seeded series lengths
 * (tests/e2e/fixtures.mjs SEED/EXPECTED), that legend + axis-tick text is
 * present, and that hovering a bar surfaces the calc-definitions sourceNote
 * line — exercising the utils/calcDefinitions.mjs registry end-to-end (the
 * expected tooltip text is imported from the SAME registry the app renders
 * from, so a registry edit keeps app + spec in lockstep).
 *
 * Determinism: the `npm run build:e2e` build sets
 * NEXT_PUBLIC_USE_FIREBASE_EMULATORS=1, which flips
 * CHART_ANIMATIONS_DISABLED (src/utils/constants.js) and disables every
 * Recharts series animation (`isAnimationActive`), so element counts are
 * stable immediately after render. No screenshot assertions in this pass.
 *
 * Scope: the dashboard home ('/') is admin-only (non-admins are redirected
 * to their own attorney page), so this spec runs in the chromium-admin
 * project only.
 */

import { test, expect } from '@playwright/test';
import { E2E_TODAY, SEED } from './fixtures.mjs';
import { getSourceNote } from '../../src/utils/calcDefinitions.mjs';

// ---------------------------------------------------------------------------
// Expected series lengths, derived from the seed (never hand-maintained).
// The dashboard's default date range is CURRENT MONTH, which with the pinned
// clock (E2E_TODAY) is July 2026.
// ---------------------------------------------------------------------------
const JULY = '2026-07';

// Overview's default cohort is 'lawyers' (role === 'Attorney'), which
// excludes the seeded Partner (Alex Adams).
const LAWYER_NAMES = SEED.users.filter((u) => u.doc.role === 'Attorney').map((u) => u.id);
const ALL_NAMES = SEED.users.map((u) => u.id);

const julyBillables = SEED.users.flatMap((u) => u.billablesDocs[JULY]?.entries ?? []);
// Every seeded billable entry uses billingCategory 'General' -> 1 category.
const JULY_CATEGORIES = [...new Set(julyBillables.map((e) => e.billingCategory))];
// Clients billed in July (all seeded entries have hours > 0).
const JULY_CLIENTS = [...new Set(julyBillables.map((e) => e.client))];
const julyLawyerBillables = SEED.users
  .filter((u) => u.doc.role === 'Attorney')
  .flatMap((u) => u.billablesDocs[JULY]?.entries ?? []);
const JULY_LAWYER_CATEGORIES = [...new Set(julyLawyerBillables.map((e) => e.billingCategory))];

// Recharts structural selectors. NOTE (recharts 3.5): axis tick VALUE <text>
// nodes no longer live inside the `.recharts-xAxis`/`.recharts-yAxis` axis
// group — they render in sibling `.recharts-<axis>-tick-labels` groups, so
// the tick selectors anchor on those.
const BAR_RECT = '.recharts-bar-rectangle';
const X_TICK = '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value';
const Y_TICK = '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value';
const LEGEND_ITEM = '.recharts-legend-item-text';
const TOOLTIP = '.recharts-tooltip-wrapper';

test.describe('dashboard charts — structural SVG assertions', () => {
  test.beforeEach(async ({ page }) => {
    // The dashboard home is admin-only; non-admins are redirected to their
    // attorney page — run this spec under the chromium-admin project only.
    test.skip(
      test.info().project.name !== 'chromium-admin',
      'The dashboard home is admin-only; non-admins are redirected to their attorney page.'
    );
    // The app computes "today" with the real clock — pin it before first
    // navigation so "Current Month" (the default range) is July 2026.
    await page.clock.setFixedTime(new Date(E2E_TODAY));
    await page.goto('/');
  });

  test('BillableVsOpsChart renders one bar per lawyer per series, with legend and axis labels', async ({ page }) => {
    const figure = page.getByRole('figure', { name: /^Billable vs Ops Time by Attorney/ });
    await expect(figure).toBeVisible({ timeout: 20000 });

    // 2 series (Billable/Ops) x lawyers cohort; every seeded lawyer has
    // non-zero July billable AND ops hours, so no zero-height bars drop out.
    await expect(figure.locator(BAR_RECT)).toHaveCount(LAWYER_NAMES.length * 2, { timeout: 20000 });

    // Legend names come from the <Bar name> props.
    await expect(figure.locator(LEGEND_ITEM)).toHaveText(['Billable Hours', 'Ops Hours']);

    // One x-axis category tick per lawyer, labeled with the display name.
    const ticks = figure.locator(X_TICK);
    await expect(ticks).toHaveCount(LAWYER_NAMES.length);
    const tickText = (await ticks.allTextContents()).join('\n');
    for (const name of LAWYER_NAMES) {
      expect(tickText).toContain(name);
    }
  });

  test('switching the cohort to Full Team re-renders with one bar per seeded user per series', async ({ page }) => {
    const figure = page.getByRole('figure', { name: /^Billable vs Ops Time by Attorney/ });
    await expect(figure.locator(BAR_RECT)).toHaveCount(LAWYER_NAMES.length * 2, { timeout: 20000 });

    await page.getByRole('button', { name: 'Full Team' }).click();

    // The Partner joins the cohort: 3 users x 2 series.
    await expect(figure.locator(BAR_RECT)).toHaveCount(ALL_NAMES.length * 2, { timeout: 20000 });
    const tickText = (await figure.locator(X_TICK).allTextContents()).join('\n');
    for (const name of ALL_NAMES) {
      expect(tickText).toContain(name);
    }
  });

  test('hovering a billable bar shows the per-bar tooltip with the calc-registry sourceNote', async ({ page }) => {
    const figure = page.getByRole('figure', { name: /^Billable vs Ops Time by Attorney/ });
    await expect(figure.locator(BAR_RECT)).toHaveCount(LAWYER_NAMES.length * 2, { timeout: 20000 });

    // First .recharts-bar layer = the billable series (declaration order).
    const billableBar = figure.locator('.recharts-bar').first().locator(`${BAR_RECT} path`).first();
    await billableBar.hover();

    const tooltip = figure.locator(TOOLTIP);
    await expect(tooltip).toBeVisible();
    // PerBarTooltip narrows to the hovered series (Bar onMouseEnter).
    await expect(tooltip).toContainText('Billable Hours:');
    // The provenance line is the registry's own text — end-to-end through
    // calcDefinitions.mjs getSourceNote('billableHours').
    await expect(tooltip).toContainText(getSourceNote('billableHours'));
  });

  test('TopTransactionsChart renders one bar per seeded billing category with sourceNote on hover', async ({ page }) => {
    const figure = page.getByRole('figure', { name: /^Top Transaction Types by Time/ });
    await expect(figure).toBeVisible({ timeout: 20000 });

    // Default 'lawyers' cohort: categories billed by lawyers in July.
    await expect(figure.locator(BAR_RECT)).toHaveCount(JULY_LAWYER_CATEGORIES.length, { timeout: 20000 });
    await expect(figure.locator(LEGEND_ITEM)).toHaveText(['Total Hours']);

    const tickText = (await figure.locator(X_TICK).allTextContents()).join('\n');
    for (const category of JULY_LAWYER_CATEGORIES) {
      expect(tickText).toContain(category);
    }

    await figure.locator(`${BAR_RECT} path`).first().hover();
    const tooltip = figure.locator(TOOLTIP);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Total Hours:');
    await expect(tooltip).toContainText(getSourceNote('billableHours'));
  });

  test('Clients tab charts render one bar per client billed in the current month', async ({ page }) => {
    await page.getByRole('button', { name: 'Clients', exact: true }).click();

    // Hours by Client — bars only for clients with billable hours in range.
    const hoursFigure = page.getByRole('figure', { name: 'Hours by Client' });
    await expect(hoursFigure).toBeVisible({ timeout: 20000 });
    await expect(hoursFigure.locator(BAR_RECT)).toHaveCount(JULY_CLIENTS.length, { timeout: 20000 });
    const hoursTicks = (await hoursFigure.locator(X_TICK).allTextContents()).join('\n');
    for (const client of JULY_CLIENTS) {
      expect(hoursTicks).toContain(client);
    }

    // Service Breadth — same client set (each has >= 1 unique category).
    const breadthFigure = page.getByRole('figure', { name: /^Service Breadth/ });
    await expect(breadthFigure.locator(BAR_RECT)).toHaveCount(JULY_CLIENTS.length, { timeout: 20000 });
    await expect(breadthFigure.locator(LEGEND_ITEM)).toHaveCount(0); // no <Legend> in this chart

    // Hover a client-hours bar: CustomTooltip + billableHours provenance.
    await hoursFigure.locator(`${BAR_RECT} path`).first().hover();
    const tooltip = hoursFigure.locator(TOOLTIP);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Total Hours:');
    await expect(tooltip).toContainText(getSourceNote('billableHours'));
  });

  test('charts have a numeric y-axis (sanity: axes render alongside series)', async ({ page }) => {
    const figure = page.getByRole('figure', { name: /^Billable vs Ops Time by Attorney/ });
    await expect(figure.locator(BAR_RECT)).toHaveCount(LAWYER_NAMES.length * 2, { timeout: 20000 });

    const yTicks = figure.locator(Y_TICK);
    expect(await yTicks.count()).toBeGreaterThan(1);
    const texts = await yTicks.allTextContents();
    for (const t of texts) {
      expect(Number.isNaN(Number(t))).toBe(false);
    }
  });
});
