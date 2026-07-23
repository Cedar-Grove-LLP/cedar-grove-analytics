// Component tests for the UtilizationTargetsTab grid (src/components/admin/
// UtilizationTargetsTab.jsx) — the two behaviors only a rendered component can
// exercise: spreadsheet-style keyboard navigation between the target inputs
// (data-row/data-col + focusCell) and multi-cell TSV paste from clipboardData.
// Firestore reads, the actuals/capacity hook, and the summary/tooltip child
// components are mocked; the grid itself renders for real.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UtilizationTargetsTab from '@/components/admin/UtilizationTargetsTab';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...path) => ({ path: path.join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  updateDoc: vi.fn(async () => {}),
}));

// Actuals/capacity come from the Firestore cache in production; the grid only
// needs the (possibly empty) maps. Empty ⇒ every month renders as elapsed with
// zero actuals, which is fine for navigation/paste testing. The object must be
// referentially stable across renders — the tab's memo chain (actuals →
// userIdsWithDataInYear → visibleUsers) feeds the targets-load effect, and a
// fresh object per render would re-trigger the loading state on every render.
const EMPTY_ACTUALS = { actuals: {}, capacity: {} };
vi.mock('@/hooks/useMonthlyActualsVsTarget', () => ({
  useMonthlyActualsVsTarget: () => EMPTY_ACTUALS,
}));

vi.mock('@/components/admin/AnnualUtilizationSummary', () => ({
  default: () => null,
}));

vi.mock('@/components/shared', () => ({
  CalcTooltip: () => null,
}));

// Two full-time attorneys — both land in the "Attorneys Full-time" TargetTable.
// Neither name is in the seniority ladder, so they sort alphabetically:
// Alice = row 0, Bob = row 1. With the default "All Year" view there are 12
// visible months ⇒ 24 columns (client/ops per month), cols 0..23.
const USERS = [
  { id: 'Alice', name: 'Alice', role: 'Attorney', employmentType: 'FTE', email: 'alice@cedargrovellp.com' },
  { id: 'Bob', name: 'Bob', role: 'Attorney', employmentType: 'FTE', email: 'bob@cedargrovellp.com' },
];

const cell = (name, month, kind) => screen.getByLabelText(`${name} ${month} ${kind} hours target`);

async function renderGrid() {
  render(<UtilizationTargetsTab users={USERS} usersLoading={false} refetch={null} />);
  // Wait for the async targets load (mocked getDoc) to finish rendering the grid.
  return await screen.findByLabelText('Alice January client hours target');
}

function pasteAt(input, text) {
  return fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('keyboard navigation', () => {
  test('arrow keys move focus between adjacent cells', async () => {
    const aliceJanClient = await renderGrid();
    aliceJanClient.focus();

    fireEvent.keyDown(aliceJanClient, { key: 'ArrowRight' });
    expect(cell('Alice', 'January', 'ops')).toHaveFocus();

    fireEvent.keyDown(cell('Alice', 'January', 'ops'), { key: 'ArrowRight' });
    expect(cell('Alice', 'February', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Alice', 'February', 'client'), { key: 'ArrowLeft' });
    expect(cell('Alice', 'January', 'ops')).toHaveFocus();

    fireEvent.keyDown(cell('Alice', 'January', 'ops'), { key: 'ArrowDown' });
    expect(cell('Bob', 'January', 'ops')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'January', 'ops'), { key: 'ArrowUp' });
    expect(cell('Alice', 'January', 'ops')).toHaveFocus();
  });

  test('arrow navigation stops at the grid edges', async () => {
    const aliceJanClient = await renderGrid();
    aliceJanClient.focus();

    // Already at row 0 / col 0 — moving up or left goes nowhere.
    fireEvent.keyDown(aliceJanClient, { key: 'ArrowLeft' });
    expect(aliceJanClient).toHaveFocus();
    fireEvent.keyDown(aliceJanClient, { key: 'ArrowUp' });
    expect(aliceJanClient).toHaveFocus();

    // Bottom-right corner: Bob / December ops (row 1, col 23).
    const corner = cell('Bob', 'December', 'ops');
    corner.focus();
    fireEvent.keyDown(corner, { key: 'ArrowRight' });
    expect(corner).toHaveFocus();
    fireEvent.keyDown(corner, { key: 'ArrowDown' });
    expect(corner).toHaveFocus();
  });

  test('Enter moves down a row; Shift+Enter moves back up', async () => {
    const aliceJanClient = await renderGrid();
    aliceJanClient.focus();

    fireEvent.keyDown(aliceJanClient, { key: 'Enter' });
    expect(cell('Bob', 'January', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'January', 'client'), { key: 'Enter', shiftKey: true });
    expect(aliceJanClient).toHaveFocus();
  });

  test('Tab wraps to the next row; Shift+Tab wraps back to the previous row end', async () => {
    await renderGrid();

    const aliceDecOps = cell('Alice', 'December', 'ops'); // row 0, col 23 (maxCol)
    aliceDecOps.focus();
    fireEvent.keyDown(aliceDecOps, { key: 'Tab' });
    expect(cell('Bob', 'January', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'January', 'client'), { key: 'Tab', shiftKey: true });
    expect(aliceDecOps).toHaveFocus();
  });

  test('Home/End jump within the row; Ctrl+Home/Ctrl+End jump to the grid corners', async () => {
    await renderGrid();

    const bobJunOps = cell('Bob', 'June', 'ops');
    bobJunOps.focus();

    fireEvent.keyDown(bobJunOps, { key: 'Home' });
    expect(cell('Bob', 'January', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'January', 'client'), { key: 'End' });
    expect(cell('Bob', 'December', 'ops')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'December', 'ops'), { key: 'Home', ctrlKey: true });
    expect(cell('Alice', 'January', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Alice', 'January', 'client'), { key: 'End', metaKey: true });
    expect(cell('Bob', 'December', 'ops')).toHaveFocus();
  });

  test('PageUp/PageDown jump to the first/last row in the same column', async () => {
    await renderGrid();

    const aliceMarClient = cell('Alice', 'March', 'client');
    aliceMarClient.focus();

    fireEvent.keyDown(aliceMarClient, { key: 'PageDown' });
    expect(cell('Bob', 'March', 'client')).toHaveFocus();

    fireEvent.keyDown(cell('Bob', 'March', 'client'), { key: 'PageUp' });
    expect(aliceMarClient).toHaveFocus();
  });

  test('Escape blurs the cell', async () => {
    const aliceJanClient = await renderGrid();
    aliceJanClient.focus();
    expect(aliceJanClient).toHaveFocus();

    fireEvent.keyDown(aliceJanClient, { key: 'Escape' });
    expect(aliceJanClient).not.toHaveFocus();
  });

  test('ordinary typing keys are not consumed by the navigator', async () => {
    const aliceJanClient = await renderGrid();
    aliceJanClient.focus();

    // fireEvent returns false when preventDefault was called: navigation keys
    // are consumed, character keys are left for the input's default behavior.
    expect(fireEvent.keyDown(aliceJanClient, { key: '5' })).toBe(true);
    expect(aliceJanClient).toHaveFocus();
    expect(fireEvent.keyDown(aliceJanClient, { key: 'ArrowRight' })).toBe(false);
  });
});

describe('TSV paste handling', () => {
  test('pastes a 2x2 tab-separated block across users and fields', async () => {
    const aliceJanClient = await renderGrid();

    const prevented = !pasteAt(aliceJanClient, '10\t5\n8\t4');
    expect(prevented).toBe(true); // grid paste takes over the event

    expect(cell('Alice', 'January', 'client')).toHaveValue(10);
    expect(cell('Alice', 'January', 'ops')).toHaveValue(5);
    expect(cell('Bob', 'January', 'client')).toHaveValue(8);
    expect(cell('Bob', 'January', 'ops')).toHaveValue(4);
    // Spill stops where the data stops.
    expect(cell('Alice', 'February', 'client')).toHaveValue(null);
  });

  test('a wide single row spills across months from the anchor cell', async () => {
    await renderGrid();

    pasteAt(cell('Alice', 'February', 'client'), '100\t20\t110\t25');

    expect(cell('Alice', 'February', 'client')).toHaveValue(100);
    expect(cell('Alice', 'February', 'ops')).toHaveValue(20);
    expect(cell('Alice', 'March', 'client')).toHaveValue(110);
    expect(cell('Alice', 'March', 'ops')).toHaveValue(25);
    expect(cell('Bob', 'February', 'client')).toHaveValue(null);
  });

  test('normalizes CRLF and ignores a trailing newline', async () => {
    await renderGrid();

    pasteAt(cell('Alice', 'January', 'client'), '1\t2\r\n3\t4\r\n');

    expect(cell('Alice', 'January', 'client')).toHaveValue(1);
    expect(cell('Alice', 'January', 'ops')).toHaveValue(2);
    expect(cell('Bob', 'January', 'client')).toHaveValue(3);
    expect(cell('Bob', 'January', 'ops')).toHaveValue(4);
  });

  test('clips paste overflow at the grid edges instead of wrapping', async () => {
    await renderGrid();

    // Anchor at the bottom-right corner: only the first value fits.
    pasteAt(cell('Bob', 'December', 'ops'), '9\t8\n7\t6');

    expect(cell('Bob', 'December', 'ops')).toHaveValue(9);
    // Nothing wrapped onto other cells.
    expect(cell('Bob', 'December', 'client')).toHaveValue(null);
    expect(cell('Alice', 'December', 'ops')).toHaveValue(null);
    expect(cell('Alice', 'January', 'client')).toHaveValue(null);
  });

  test('trims whitespace around pasted values and keeps empty cells empty', async () => {
    await renderGrid();

    pasteAt(cell('Alice', 'January', 'client'), ' 7 \t\t 3 ');

    expect(cell('Alice', 'January', 'client')).toHaveValue(7);
    // Middle cell was an empty TSV field → stays blank.
    expect(cell('Alice', 'January', 'ops')).toHaveValue(null);
    expect(cell('Alice', 'February', 'client')).toHaveValue(3);
  });

  test('single scalar paste is left to the default input behavior', async () => {
    const aliceJanClient = await renderGrid();

    // No tab/newline → the handler returns without preventDefault, so the
    // browser's native paste-into-input applies (a no-op in jsdom).
    const notPrevented = pasteAt(aliceJanClient, '42');
    expect(notPrevented).toBe(true);
    expect(aliceJanClient).toHaveValue(null);
  });

  test('empty clipboard is ignored', async () => {
    const aliceJanClient = await renderGrid();
    expect(pasteAt(aliceJanClient, '')).toBe(true);
    expect(aliceJanClient).toHaveValue(null);
  });
});
