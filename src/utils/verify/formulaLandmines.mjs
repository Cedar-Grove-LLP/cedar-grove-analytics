/**
 * Formula-text landmines: defects that are invisible to every value-leg
 * comparison because the broken formula happens to evaluate to the same
 * value as the correct one today. The only way to catch them is to read
 * the cell with `valueRenderOption=FORMULA` and inspect the formula text
 * itself, never its computed value.
 *
 * The flagship case: the 83(b) election bonus. Canonical formula is
 * SUM(<FlatFee column>)*0.65 ($162.50 per $250 election). 9 of 10 books
 * carry a `*65` (100x) typo on their July + Template tabs instead of
 * `*0.65`. It evaluates to $0 today because no July elections exist yet,
 * so SHEET, FS_TOTALS, FS_ENTRIES, and ORACLE all agree at 0 — a value
 * comparison structurally cannot see this bug. This registry exists
 * precisely for that reason.
 *
 * Pure module — no React/Firebase imports; Node-importable.
 */

export const FORMULA_LANDMINES = Object.freeze([
  {
    id: 'elections-83b-times-0.65',
    cell: 'B4',
    tabs: ['July', 'Template'],
    pattern: /\*\s*0\.65\b/,
    description: 'Canonical 83(b) bonus formula is SUM(<FlatFee column>)*0.65 ($162.50 per $250 '
      + 'election). 9 of 10 books carry a *65 (100x) typo instead of *0.65. It evaluates to $0 '
      + 'today (no July elections exist) so every value leg — SHEET, FS_TOTALS, FS_ENTRIES, '
      + 'ORACLE — agrees at $0.00. DORMANT: no value comparison can ever catch this; only reading '
      + 'the FORMULA render text (valueRenderOption=FORMULA) and matching the pattern can.',
    // Column the typo'd SUM() targets varies by book layout; documented here for the
    // report, not consumed by checkFormulaText (pattern match is layout-independent).
    booksWithTypo: [
      { book: 'van Loon', column: 'Q', formula: '=SUM(Q:Q)*65' },
      { book: 'Manning', column: 'Q', formula: '=SUM(Q:Q)*65' },
      {
        book: 'McClure',
        column: 'Q',
        formula: '=SUM(Q:Q)*65',
        note: 'doubly wrong — the Adjustment ($) column shifted the block, so this sums col Q '
          + '("Name", text) instead of col R ("Flat Fee"); correct target is =SUM(R:R)*0.65.',
      },
      { book: 'Ohta', column: 'Q', formula: '=SUM(Q:Q)*65' },
      { book: 'Uscanga', column: 'Q', formula: '=SUM(Q:Q)*65' },
      { book: 'Agate', column: 'L', formula: '=SUM(L:L)*65' },
      { book: 'Skrodzka', column: 'L', formula: '=SUM(L:L)*65' },
      { book: 'Wilson', column: 'L', formula: '=SUM(L:L)*65' },
      { book: 'Popkin', column: 'L', formula: '=SUM(L:L)*65' },
    ],
    // The one book that got it right — confirms the pattern isn't a false negative.
    correctBook: { book: 'Levin', column: 'Q', formula: '=SUM(Q:Q)*0.65' },
  },
]);

/**
 * Test a live FORMULA-rendered cell string against a landmine's expected
 * pattern. `pass:false` means the landmine is present (the typo matched);
 * `pass:true` means the cell carries the correct formula.
 *
 * @param {string} cellText   raw formula text, e.g. '=SUM(Q:Q)*65'
 * @param {{pattern:RegExp}} landmine
 * @returns {{pass:boolean, got:string}}
 */
export function checkFormulaText(cellText, landmine) {
  return { pass: landmine.pattern.test(cellText), got: cellText };
}
