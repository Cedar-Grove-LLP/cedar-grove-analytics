/**
 * LIVE collector — per-attorney timesheet workbooks vs Firestore
 * users/{attorney}/{billables,ops,eightThreeB}/{year}_{MonthName}.
 *
 * Thin IO shell: fetches live Sheets tabs + Firestore docs, sums the
 * resolved columns (sheetLayout.mjs / subject.mjs's sumColumn), builds
 * Divergence records (divergence.mjs), and returns them UNCLASSIFIED — the
 * entry point (scripts/verify-parity-live.mjs) runs classify() on every
 * record. This module makes zero decisions about what a divergence means.
 *
 * Read-only: spreadsheets.readonly (via scripts/lib/sheetsAuth.mjs) +
 * Firestore Admin read (via scripts/lib/firestore.mjs, passed in as `db`).
 */

import { LEG, LEG_STATE, makeDivergence } from '../../src/utils/verify/divergence.mjs';
import { resolveLayout, resolveTabToMonth } from '../../src/utils/verify/sheetLayout.mjs';
import { classifyEarningsLabel, takeHomeRatio, oracleEarnings } from '../../src/utils/verify/currency.mjs';
import { findRateInfo } from '../../src/utils/rateLookup.mjs';
import { WORKBOOKS } from '../../src/utils/verify/workbooks.mjs';
import { listTabs, batchGet, capGuard } from '../lib/sheetsAuth.mjs';
import {
  subjectFor, presentLeg, absentLeg, notCheckedLeg, naLeg, round2, sumColumn,
} from './subject.mjs';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM' -> the Firestore doc id '{year}_{MonthName}'. */
function monthDocId(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}_${MONTH_NAMES[month - 1]}`;
}

/** Firestore Timestamp | {_seconds} | Date | string -> ISO string, or null. */
function tsToISO(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return String(ts);
}

/** Non-blank cells below the header in `colIndex` — the row-count analogue of sumColumn. */
function countRows(grid, headerRowIndex, colIndex) {
  if (colIndex === null || colIndex === undefined) return 0;
  let n = 0;
  for (let i = headerRowIndex + 1; i < grid.length; i += 1) {
    const cell = grid[i]?.[colIndex];
    if (cell !== undefined && cell !== null && String(cell).trim() !== '') n += 1;
  }
  return n;
}

function sumEntryField(entries, field) {
  return round2((entries || []).reduce((sum, e) => sum + (Number(e[field]) || 0), 0));
}

/** Build a { 'YYYY-MM': {rate, takeHomeRate} } map from a users/{id}.rates[] array. */
function buildRatesMap(rates) {
  const map = {};
  (rates || []).forEach((r) => {
    const monthNum = MONTH_NAMES.indexOf(r.month) + 1;
    if (!monthNum || !r.year) return;
    const monthKey = `${r.year}-${String(monthNum).padStart(2, '0')}`;
    map[monthKey] = { rate: r.rate, takeHomeRate: r.takeHomeRate ?? null };
  });
  return map;
}

const SCHEMA_EVOLUTION_FIELDS = ['clientFilingFees', 'totalEarnings'];

export async function collectTimesheetDivergences({ token, db }) {
  const divergences = [];
  const periods = [];
  const coverage = {
    workbooksChecked: 0,
    bookBlindSpots: 0,
    tabsMatched: 0,
    tabsIgnored: 0,
    tabsUnparseable: 0,
    tabBlindSpots: 0,
    rangeCapHits: 0,
    layoutsUnrecognized: 0,
    signaturesSeen: new Set(),
  };

  const workbooks = WORKBOOKS.filter((w) => w.attorney);

  for (const workbook of workbooks) {
    coverage.workbooksChecked += 1;

    const tabsRes = await listTabs(token, workbook.spreadsheetId);
    if (tabsRes.blindSpot) {
      coverage.bookBlindSpots += 1;
      divergences.push(makeDivergence({
        id: `coverage:${workbook.key}:book`,
        domain: 'coverage',
        subject: subjectFor(workbook, null),
        metric: 'coverage',
        legs: { [LEG.SHEET]: notCheckedLeg(tabsRes.blindSpot.reason, tabsRes.blindSpot.httpStatus) },
      }));
      continue;
    }

    const userSnap = await db.doc(`users/${workbook.attorney}`).get();
    const ratesMap = buildRatesMap(userSnap.exists ? userSnap.data().rates : []);

    for (const tabName of tabsRes.tabs) {
      const tabRes = resolveTabToMonth(workbook.key, tabName);
      if (tabRes.status === 'ignored') { coverage.tabsIgnored += 1; continue; }
      if (tabRes.status === 'unparseable') { coverage.tabsUnparseable += 1; continue; }
      coverage.tabsMatched += 1;

      const { monthKey } = tabRes;
      const subject = { ...subjectFor(workbook, monthKey), tab: tabName };

      const range = workbook.tabRange.replace('{tab}', tabName);
      const { grids, blindSpot } = await batchGet(token, workbook.spreadsheetId, [range]);
      if (blindSpot) {
        coverage.tabBlindSpots += 1;
        divergences.push(makeDivergence({
          id: `coverage:${workbook.key}:${monthKey}`,
          domain: 'coverage',
          subject,
          metric: 'coverage',
          legs: { [LEG.SHEET]: notCheckedLeg(blindSpot.reason, blindSpot.httpStatus) },
        }));
        continue;
      }

      const grid = grids[range];
      const cap = capGuard(range, grid.length);
      if (cap.hit) {
        coverage.rangeCapHits += 1;
        divergences.push(makeDivergence({
          id: `coverage:${workbook.key}:${monthKey}:rangeCap`,
          domain: 'coverage',
          subject,
          metric: 'rangeCap',
          legs: { [LEG.SHEET]: notCheckedLeg(`range cap hit — ${grid.length} rows >= bound ${cap.bound}; widen tabRange`, null) },
        }));
        continue;
      }

      const layout = resolveLayout(grid);
      if (layout.signatureId === null) {
        coverage.layoutsUnrecognized += 1;
        divergences.push(makeDivergence({
          id: `coverage:${workbook.key}:${monthKey}:layout`,
          domain: 'coverage',
          subject,
          metric: 'earnings',
          legs: { [LEG.SHEET]: { state: LEG_STATE.PRESENT, value: null, meta: { signatureId: null, rowsRead: grid.length } } },
        }));
        continue;
      }
      coverage.signaturesSeen.add(layout.signatureId);

      const { columns, headerRowIndex, earningsLabel } = layout;
      const rowsRead = countRows(grid, headerRowIndex, columns.client);
      const billableHoursSheet = sumColumn(grid, headerRowIndex, columns.hours);
      const billableEarningsSheet = sumColumn(grid, headerRowIndex, columns.earnings);
      const opsHoursSheet = sumColumn(grid, headerRowIndex, columns.opsHours);
      const opsRowsRead = countRows(grid, headerRowIndex, columns.ops);
      const clientFilingFeesSheet = sumColumn(grid, headerRowIndex, columns.clientFilingFees);
      const flatFeeSheet = sumColumn(grid, headerRowIndex, columns.flatFee);
      const flatFeeRowsRead = countRows(grid, headerRowIndex, columns.company);

      const [billablesSnap, opsSnap, e83bSnap] = await Promise.all([
        db.doc(`users/${workbook.attorney}/billables/${monthDocId(monthKey)}`).get(),
        db.doc(`users/${workbook.attorney}/ops/${monthDocId(monthKey)}`).get(),
        db.doc(`users/${workbook.attorney}/eightThreeB/${monthDocId(monthKey)}`).get(),
      ]);

      // ---------------------------------------------------------- billables
      const bData = billablesSnap.exists ? billablesSnap.data() : null;
      const bEntries = bData?.entries ?? [];
      const bSyncedAt = tsToISO(bData?.syncedAt);
      const bTotals = bData?.sheetTotals ?? null;

      const sheetLeg = (extra = {}) => presentLeg(billableHoursSheet, {
        rowsRead, signatureId: layout.signatureId, ...extra,
      });

      // ---- hours ----
      divergences.push(makeDivergence({
        id: `billables:${workbook.userId}:${monthKey}:hours`,
        domain: 'billables',
        subject,
        metric: 'hours',
        legs: {
          [LEG.SHEET]: presentLeg(billableHoursSheet, { rowsRead, signatureId: layout.signatureId }),
          [LEG.FS_TOTALS]: !bData
            ? absentLeg({ reason: 'billables doc missing', syncedAt: null })
            : bTotals && 'totalBillableHours' in bTotals
              ? presentLeg(bTotals.totalBillableHours, { entryCount: bData.entryCount ?? bEntries.length, syncedAt: bSyncedAt })
              : absentLeg({ syncedAt: bSyncedAt }),
          [LEG.FS_ENTRIES]: !bData
            ? absentLeg({ reason: 'billables doc missing' })
            : presentLeg(sumEntryField(bEntries, 'hours'), { entryCount: bEntries.length }),
          [LEG.ORACLE]: naLeg(),
        },
      }));

      // ---- earnings (the ORACLE leg) ----
      const labelSystem = classifyEarningsLabel(earningsLabel);
      let oracleLeg = naLeg();
      if (labelSystem === 'CLIENT_BILLED') {
        const rateInfo = findRateInfo(ratesMap, monthKey);
        const { ratio, reason } = takeHomeRatio(rateInfo);
        if (ratio === null) {
          oracleLeg = notCheckedLeg(reason, null);
        } else {
          const oracleVal = oracleEarnings({ sheetEarnings: billableEarningsSheet, labelSystem, ratio });
          oracleLeg = presentLeg(oracleVal, { ratio, clientRate: rateInfo.rate, takeHomeRate: rateInfo.takeHomeRate });
        }
      }

      divergences.push(makeDivergence({
        id: `billables:${workbook.userId}:${monthKey}:earnings`,
        domain: 'billables',
        subject,
        metric: 'earnings',
        legs: {
          [LEG.SHEET]: presentLeg(billableEarningsSheet, {
            columnLabel: earningsLabel, hours: billableHoursSheet, rowsRead, signatureId: layout.signatureId,
          }),
          [LEG.FS_TOTALS]: !bData
            ? absentLeg({ reason: 'billables doc missing', syncedAt: null })
            : bTotals && 'billableEarnings' in bTotals
              ? presentLeg(bTotals.billableEarnings, { entryCount: bData.entryCount ?? bEntries.length, syncedAt: bSyncedAt })
              : absentLeg({ syncedAt: bSyncedAt }),
          [LEG.FS_ENTRIES]: !bData
            ? absentLeg({ reason: 'billables doc missing' })
            : presentLeg(sumEntryField(bEntries, 'earnings'), { entryCount: bEntries.length, hours: sumEntryField(bEntries, 'hours') }),
          [LEG.ORACLE]: oracleLeg,
        },
      }));

      // ---- entryCount (billables) ----
      divergences.push(makeDivergence({
        id: `billables:${workbook.userId}:${monthKey}:entryCount`,
        domain: 'billables',
        subject,
        metric: 'entryCount',
        legs: {
          [LEG.SHEET]: presentLeg(rowsRead, { rowsRead, signatureId: layout.signatureId }),
          [LEG.FS_TOTALS]: !bData
            ? absentLeg({ reason: 'billables doc missing', syncedAt: null })
            : presentLeg(bData.entryCount ?? bEntries.length, { syncedAt: bSyncedAt }),
          [LEG.FS_ENTRIES]: !bData
            ? absentLeg({ reason: 'billables doc missing' })
            : presentLeg(bEntries.length, { entryCount: bEntries.length }),
          [LEG.ORACLE]: naLeg(),
        },
      }));

      // ---- clientFilingFees (schema-gap path) ----
      const sheetHasFilingFeesCol = columns.clientFilingFees !== null;
      const fsHasFilingFeesKey = !!(bTotals && 'clientFilingFees' in bTotals);
      divergences.push(makeDivergence({
        id: `billables:${workbook.userId}:${monthKey}:clientFilingFees`,
        domain: 'billables',
        subject,
        metric: 'clientFilingFees',
        legs: {
          [LEG.SHEET]: sheetHasFilingFeesCol
            ? presentLeg(clientFilingFeesSheet, { rowsRead, signatureId: layout.signatureId })
            : naLeg(),
          [LEG.FS_TOTALS]: !bData
            ? absentLeg({ reason: 'billables doc missing', syncedAt: null })
            : fsHasFilingFeesKey
              ? presentLeg(bTotals.clientFilingFees, { entryCount: bData.entryCount ?? bEntries.length, syncedAt: bSyncedAt })
              : absentLeg({ syncedAt: bSyncedAt }),
          [LEG.FS_ENTRIES]: !bData
            ? absentLeg({ reason: 'billables doc missing' })
            : fsHasFilingFeesKey
              ? presentLeg(sumEntryField(bEntries, 'clientFilingFees'), { entryCount: bEntries.length })
              : absentLeg({ syncedAt: bSyncedAt }),
          [LEG.ORACLE]: naLeg(),
        },
      }));

      // ---- totalEarnings: schema-gap probe ONLY. This field has no distinct
      //      sheet column to compare against (it mirrors billableEarnings,
      //      which is already checked as the `earnings` metric), so a
      //      present-and-parsed value has nothing to reconcile — emitting it
      //      as a lone FS_TOTALS leg produced pure UNKNOWN noise. We emit only
      //      when the key is ABSENT, so ruleSchemaGap can document the
      //      pre-cutover schema evolution and a post-cutover absence stays loud.
      if (bData && !(bTotals && 'totalEarnings' in bTotals)) {
        divergences.push(makeDivergence({
          id: `billables:${workbook.userId}:${monthKey}:totalEarnings`,
          domain: 'billables',
          subject,
          metric: 'totalEarnings',
          legs: {
            [LEG.SHEET]: naLeg(),
            [LEG.FS_TOTALS]: absentLeg({ syncedAt: bSyncedAt }),
            [LEG.FS_ENTRIES]: naLeg(),
            [LEG.ORACLE]: naLeg(),
          },
        }));
      }

      // -------------------------------------------------------------- ops
      const oData = opsSnap.exists ? opsSnap.data() : null;
      const oEntries = oData?.entries ?? [];
      const oSyncedAt = tsToISO(oData?.syncedAt);
      const oTotals = oData?.sheetTotals ?? null;

      divergences.push(makeDivergence({
        id: `ops:${workbook.userId}:${monthKey}:opsHours`,
        domain: 'ops',
        subject,
        metric: 'opsHours',
        legs: {
          [LEG.SHEET]: presentLeg(opsHoursSheet, { rowsRead: opsRowsRead, signatureId: layout.signatureId }),
          [LEG.FS_TOTALS]: !oData
            ? absentLeg({ reason: 'ops doc missing', syncedAt: null })
            : oTotals && 'opsHours' in oTotals
              ? presentLeg(oTotals.opsHours, { entryCount: oData.entryCount ?? oEntries.length, syncedAt: oSyncedAt })
              : absentLeg({ syncedAt: oSyncedAt }),
          [LEG.FS_ENTRIES]: !oData
            ? absentLeg({ reason: 'ops doc missing' })
            : presentLeg(sumEntryField(oEntries, 'hours'), { entryCount: oEntries.length }),
          [LEG.ORACLE]: naLeg(),
        },
      }));

      divergences.push(makeDivergence({
        id: `ops:${workbook.userId}:${monthKey}:entryCount`,
        domain: 'ops',
        subject,
        metric: 'entryCount',
        legs: {
          [LEG.SHEET]: presentLeg(opsRowsRead, { rowsRead: opsRowsRead, signatureId: layout.signatureId }),
          [LEG.FS_TOTALS]: !oData
            ? absentLeg({ reason: 'ops doc missing', syncedAt: null })
            : presentLeg(oData.entryCount ?? oEntries.length, { syncedAt: oSyncedAt }),
          [LEG.FS_ENTRIES]: !oData
            ? absentLeg({ reason: 'ops doc missing' })
            : presentLeg(oEntries.length, { entryCount: oEntries.length }),
          [LEG.ORACLE]: naLeg(),
        },
      }));

      // -------------------------------------------------------- eightThreeB
      // Compare the 83(b) FLAT-FEE FACE VALUE like-for-like: the sheet's Flat
      // Fee column sum vs entries[].flatFee sum. NOTE the two-dollar-systems
      // trap at the 83(b) level — sheetTotals.eightThreeBFeeEarnings is the
      // TAKE-HOME bonus (0.65 × face value, e.g. $162.50 per $250 election),
      // a DIFFERENT quantity, so it must NOT sit on the FS_TOTALS leg of a
      // flatFee metric (doing so fabricated a "misparse" on every clean 83(b)
      // doc). Skip months with no 83(b) activity on either side — nothing to
      // reconcile — but still emit when the sheet is empty yet Firestore has
      // entries, so the phantom-template-entries defect (fabricated flatFee
      // rows) stays catchable.
      const eData = e83bSnap.exists ? e83bSnap.data() : null;
      const eEntries = eData?.entries ?? [];
      const fsFlatFee = eData ? sumEntryField(eEntries, 'flatFee') : null;
      const hasActivity = flatFeeSheet !== 0 || (fsFlatFee !== null && fsFlatFee !== 0);
      if (hasActivity) {
        divergences.push(makeDivergence({
          id: `eightThreeB:${workbook.userId}:${monthKey}:flatFee`,
          domain: 'eightThreeB',
          subject,
          metric: 'flatFee',
          legs: {
            [LEG.SHEET]: presentLeg(flatFeeSheet, { rowsRead: flatFeeRowsRead, signatureId: layout.signatureId }),
            [LEG.FS_TOTALS]: naLeg(),
            [LEG.FS_ENTRIES]: !eData
              ? absentLeg({ reason: 'eightThreeB doc missing' })
              : presentLeg(fsFlatFee, { entryCount: eEntries.length }),
            [LEG.ORACLE]: naLeg(),
          },
        }));
      }

      // ---- data-quality periods (modelledDataStats input) ----
      periods.push({ attorney: workbook.attorney, monthKey, domain: 'timesheets', hours: billableHoursSheet });
      periods.push({ attorney: workbook.attorney, monthKey, domain: 'ops', hours: opsHoursSheet });
    }
  }

  coverage.signaturesSeen = [...coverage.signaturesSeen];
  return { divergences, coverage, periods };
}
