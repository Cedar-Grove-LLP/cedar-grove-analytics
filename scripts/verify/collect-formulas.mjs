/**
 * Live collector for the 83(b) bonus-formula landmine (BUILD-SPEC-verify.md
 * §5 rule 8 / §9 step 10). Reads each landmine cell with
 * valueRenderOption=FORMULA — NOT UNFORMATTED_VALUE — because the typo'd
 * formula evaluates to the same $0 as the correct one today (no July
 * elections exist yet); only the formula TEXT reveals the defect (see
 * src/utils/verify/formulaLandmines.mjs).
 *
 * Scope: the 2026 workbook per attorney only. The ground-truth "9 of 10
 * books" typo count names exactly ten attorneys (van Loon, Manning,
 * McClure, Ohta, Uscanga, Agate, Skrodzka, Wilson, Popkin, Levin) — that is
 * precisely the 2026 book list minus munoz-2026 (403), not each attorney's
 * 2025 book too. Firm books (attorney: null) and any book already in
 * EXPECTED_BLIND_SPOTS are skipped cleanly here — those surface their own
 * BLIND_SPOT elsewhere (collect-timesheets.mjs). An UNEXPECTED failure
 * (listTabs/batchGet blindSpot on a book not on that list) still surfaces
 * loudly as a NOT_CHECKED leg -> BLIND_SPOT, per the no-silent-caps
 * philosophy — this collector never swallows an unrecognized 403.
 *
 * Each typo'd cell is tagged `meta.knownPattern` on a PRESENT FS_ENTRIES leg
 * so ruleKnownDefect (classifiers.mjs) claims it with
 * evidence.defectId === 'elections-83b-times-0.65-typo' — the exact string
 * the elections-83b-times65-typo ledger entry's `match()` reads
 * (knownDivergences.mjs). Both SHEET and FS_ENTRIES legs carry `value: 0`
 * (the dormant evaluated amount) rather than the formula text, so the two
 * value legs AGREE with each other and neither ruleStaleness nor ruleAgree
 * claims the record ahead of ruleKnownDefect in the chain — verified live
 * below. The formula text itself lives only in SHEET.meta.cellText, which
 * nothing in the classifier chain reads; it exists so the report can show
 * "got '=SUM(Q:Q)*65'". This is deliberate and is the concrete proof that a
 * value-leg comparison structurally cannot see this bug and only
 * formula-text inspection (this collector) can.
 *
 * NOTE on the ledger's band: knownDivergences.mjs's `elections-83b-times65-
 * typo` entry declares `band: {field:'bookCount', min:0, max:10}`, but
 * ruleKnownDefect's collector-tagged branch (classifiers.mjs) builds a fixed
 * evidence shape — {defectId, expected, actual, delta, affectedRows, why} —
 * and does NOT copy arbitrary leg meta (e.g. a `meta.bookCount`) into it.
 * So `evidence.bookCount` is never populated by any collector today, and
 * matchBaseline() treats a band field absent from evidence as satisfied
 * (see knownDivergences.mjs matchBaseline), meaning this band is currently a
 * no-op — any number of typo'd books baselines as inBand:true. This is the
 * smallest core-compatible shape available without touching the pure core:
 * the fix, if wanted, is a knownDivergences.mjs/classifiers.mjs change (e.g.
 * ruleKnownDefect copying a `bookCount` from context), not a workaround
 * bolted onto this collector.
 */

import { FORMULA_LANDMINES, checkFormulaText } from '../../src/utils/verify/formulaLandmines.mjs';
import { WORKBOOKS, EXPECTED_BLIND_SPOTS } from '../../src/utils/verify/workbooks.mjs';
import { makeDivergence } from '../../src/utils/verify/divergence.mjs';
import { subjectFor, presentLeg, notCheckedLeg } from './subject.mjs';
import { listTabs, batchGet } from '../lib/sheetsAuth.mjs';

const KNOWN_PATTERN = 'elections-83b-times-0.65-typo';

const isExpectedBlindSpot = (workbookKey) => EXPECTED_BLIND_SPOTS.some((b) => b.workbookKey === workbookKey);
const rangeFor = (tab, cell) => `'${tab}'!${cell}`;

function notCheckedDivergence(workbook, blindSpot) {
  return makeDivergence({
    id: `formula:${workbook.userId}:${workbook.year}:bonusFormula`,
    domain: 'formula',
    subject: subjectFor(workbook, null),
    metric: 'bonusFormula',
    legs: { SHEET: notCheckedLeg(blindSpot.reason, blindSpot.httpStatus) },
  });
}

/**
 * @param {{token: string}} args
 * @returns {Promise<{divergences: object[], coverage: object}>}
 */
export async function collectFormulaDivergences({ token }) {
  const divergences = [];
  const byBook = [];

  const books = WORKBOOKS.filter(
    (wb) => wb.attorney !== null && wb.year === 2026 && !isExpectedBlindSpot(wb.key)
  );

  for (const workbook of books) {
    const tabsResult = await listTabs(token, workbook.spreadsheetId);
    if (tabsResult.blindSpot) {
      divergences.push(notCheckedDivergence(workbook, tabsResult.blindSpot));
      byBook.push({ workbookKey: workbook.key, attorney: workbook.attorney, blindSpot: tabsResult.blindSpot, results: [] });
      continue;
    }

    const bookResults = [];
    for (const landmine of FORMULA_LANDMINES) {
      const presentTabs = landmine.tabs.filter((t) => tabsResult.tabs.has(t));
      if (presentTabs.length === 0) continue; // e.g. no "Template" tab in this book — expected, not an error

      const ranges = presentTabs.map((t) => rangeFor(t, landmine.cell));
      const batchResult = await batchGet(token, workbook.spreadsheetId, ranges, { valueRenderOption: 'FORMULA' });
      if (batchResult.blindSpot) {
        divergences.push(notCheckedDivergence(workbook, batchResult.blindSpot));
        bookResults.push({ landmine: landmine.id, blindSpot: batchResult.blindSpot });
        continue;
      }

      for (const tab of presentTabs) {
        const range = rangeFor(tab, landmine.cell);
        const cellText = String(batchResult.grids[range]?.[0]?.[0] ?? '');
        const { pass, got } = checkFormulaText(cellText, landmine);
        bookResults.push({ landmine: landmine.id, tab, pass, got });

        if (pass) continue; // correct formula — negative control (Levin); no divergence to raise

        const monthKey = tab === 'July' ? `${workbook.year}-07` : null;
        divergences.push(
          makeDivergence({
            id: `formula:${workbook.userId}:${workbook.year}-${tab.toLowerCase()}:bonusFormula`,
            domain: 'formula',
            subject: subjectFor(workbook, monthKey),
            metric: 'bonusFormula',
            legs: {
              SHEET: presentLeg(0, { cellText: got, cell: landmine.cell, tab, landmineId: landmine.id }),
              FS_ENTRIES: presentLeg(0, { knownPattern: KNOWN_PATTERN }),
            },
          })
        );
      }
    }
    byBook.push({ workbookKey: workbook.key, attorney: workbook.attorney, results: bookResults });
  }

  const allResults = byBook.flatMap((b) => b.results.filter((r) => 'pass' in r));
  const typoCount = allResults.filter((r) => !r.pass).length;
  const correctCount = allResults.filter((r) => r.pass).length;
  const typoBookCount = byBook.filter((b) => b.results.some((r) => 'pass' in r && !r.pass)).length;
  const correctBookCount = byBook.filter(
    (b) => b.results.length > 0 && b.results.every((r) => 'pass' in r && r.pass)
  ).length;

  const coverage = {
    booksChecked: books.length,
    landminesChecked: FORMULA_LANDMINES.length,
    cellsChecked: allResults.length,
    typoCount,
    correctCount,
    typoBookCount,
    correctBookCount,
    byBook,
  };

  return { divergences, coverage };
}
