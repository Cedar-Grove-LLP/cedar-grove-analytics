/**
 * Pure helpers for the timesheet coverage audit. No firebase imports — every
 * function takes plain data so the logic is unit-testable (tests/) and the
 * Firestore I/O stays in scripts/audit-timesheet-coverage.mjs.
 *
 * Several functions deliberately mirror app code that Node can't import
 * (src/utils/dateHelpers.js and src/context/FirestoreDataContext.js are CJS
 * to Node because package.json has no "type":"module"):
 *  - getMonthNumber          mirrors dateHelpers.js getMonthNumber
 *  - parseEntryDate          mirrors dateHelpers.js getEntryDate (PST calendar day)
 *  - buildRatesMapFromUserDoc mirrors FirestoreDataContext rates[] processing
 *  - summarizeMonthDoc        mirrors FirestoreDataContext sheetTotals checks (round2)
 */

import { findRateInfo, monthKeyFromDate } from '../../src/utils/rateLookup.mjs';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const getMonthNumber = (monthName) =>
  MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName?.toLowerCase()) + 1 || 1;

export const monthKeyOf = (year, monthNum) =>
  `${year}-${String(monthNum).padStart(2, '0')}`;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const PST_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Mirror of getEntryDate: local midnight of the PST calendar day. */
export function parseEntryDate(entry) {
  let raw;
  if (entry.date?.toDate) {
    raw = entry.date.toDate();
  } else if (entry.date && typeof entry.date === 'object' && entry.date.seconds) {
    raw = new Date(entry.date.seconds * 1000);
  } else if (entry.date) {
    raw = new Date(entry.date);
  } else if (entry.year && entry.month) {
    return new Date(entry.year, getMonthNumber(entry.month) - 1);
  } else {
    return null;
  }

  if (!raw || isNaN(raw.getTime())) return null;

  const parts = Object.fromEntries(
    PST_DATE_PARTS.formatToParts(raw)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, parseInt(p.value, 10)])
  );
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** users/{id}.rates[] ({month:'January', year, rate}) -> { 'YYYY-MM': {rate,...} } */
export function buildRatesMapFromUserDoc(userDocData) {
  const ratesMap = {};
  if (!Array.isArray(userDocData?.rates)) return ratesMap;
  userDocData.rates.forEach((rateEntry) => {
    // getMonthNumber mirrors dateHelpers.js's fallback-to-January behavior for
    // a non-matching month name — an existing app quirk this function must
    // reproduce faithfully (see the file header), not silently diverge from.
    // But absorbing a malformed `month` without a trace would defeat the
    // whole point of an audit tool, so warn loudly on stdout (this is a CLI
    // script; that's its actual output channel) while still computing the
    // same value the live app would.
    const isRecognized = MONTH_NAMES.some(
      (m) => m.toLowerCase() === rateEntry.month?.toLowerCase()
    );
    if (!isRecognized) {
      console.warn(
        `  [WARN] rates[] entry has an unrecognized month ${JSON.stringify(rateEntry.month)} ` +
        `(year ${rateEntry.year}) — falling back to January, mirroring the app's ` +
        `dateHelpers.js behavior. This is almost certainly bad source data; fix it.`
      );
    }
    const monthNum = getMonthNumber(rateEntry.month);
    ratesMap[monthKeyOf(rateEntry.year, monthNum)] = {
      rate: rateEntry.rate || 0,
      month: monthNum,
      year: rateEntry.year,
    };
  });
  return ratesMap;
}

export function rateBounds(ratesMap) {
  const keys = Object.keys(ratesMap || {}).sort();
  return {
    count: keys.length,
    earliest: keys[0] || null,
    latest: keys[keys.length - 1] || null,
  };
}

/**
 * Summarize one billables/ops/eightThreeB month doc: entry counts, summed
 * hours/earnings, and entry-sum vs sheetTotals mismatches using the same
 * round-to-2 comparison FirestoreDataContext uses for dataWarnings.
 */
export function summarizeMonthDoc(type, docId, docData) {
  const entries = docData?.entries || [];
  const sheetTotals = docData?.sheetTotals || null;

  let hours = 0;
  let earnings = 0;
  let flatFees = 0;
  entries.forEach((entry) => {
    hours += parseFloat(entry.hours) || 0;
    earnings += parseFloat(entry.earnings) || 0;
    flatFees += parseFloat(entry.flatFee) || 0;
  });
  hours = round2(hours);
  earnings = round2(earnings);
  flatFees = round2(flatFees);

  const mismatches = [];
  if (sheetTotals) {
    if (type === 'billables') {
      if (sheetTotals.totalBillableHours > 0 && hours !== sheetTotals.totalBillableHours) {
        mismatches.push(`hours ${hours} != sheet ${sheetTotals.totalBillableHours}`);
      }
      if (sheetTotals.billableEarnings > 0 && earnings !== sheetTotals.billableEarnings) {
        mismatches.push(`earnings ${earnings} != sheet ${sheetTotals.billableEarnings}`);
      }
    } else if (type === 'ops') {
      if (sheetTotals.opsHours > 0 && hours !== sheetTotals.opsHours) {
        mismatches.push(`hours ${hours} != sheet ${sheetTotals.opsHours}`);
      }
    }
  }

  return {
    type,
    docId,
    month: docData?.month || '',
    year: docData?.year ?? null,
    entryCount: entries.length,
    hours,
    earnings,
    flatFees,
    sheetTotals,
    mismatches,
  };
}

/**
 * Stats for a date window over one user's raw month docs, using the SAME
 * backward-fallback rate logic the app uses (findRateInfo from
 * src/utils/rateLookup.mjs) so the audit's gross matches what the dashboard
 * would compute.
 *
 * billableDocs/opsDocs: [{ docId, data }] raw Firestore month-doc payloads.
 */
export function windowStats({ billableDocs = [], opsDocs = [] }, ratesMap, windowStart, windowEnd) {
  let billableHours = 0;
  let opsHours = 0;
  let gross = 0;
  const missingRateMonthKeys = new Set();
  const monthKeysWithHours = new Set();

  billableDocs.forEach(({ data }) => {
    (data?.entries || []).forEach((entry) => {
      const date = parseEntryDate({ ...entry, month: data?.month, year: data?.year });
      if (!date || date < windowStart || date > windowEnd) return;
      const hours = parseFloat(entry.hours) || 0;
      if (hours <= 0) return;

      billableHours += hours;
      // Same formatter the app's rate lookup uses — the keys MUST match
      // findRateInfo's expectations or the audit diverges from app behavior.
      const monthKey = monthKeyFromDate(date);
      monthKeysWithHours.add(monthKey);

      const info = findRateInfo(ratesMap || {}, monthKey);
      if (info.found) {
        gross += info.rate * hours;
      } else {
        missingRateMonthKeys.add(monthKey);
      }
    });
  });

  opsDocs.forEach(({ data }) => {
    (data?.entries || []).forEach((entry) => {
      const date = parseEntryDate({ ...entry, month: data?.month, year: data?.year });
      if (!date || date < windowStart || date > windowEnd) return;
      opsHours += parseFloat(entry.hours) || 0;
    });
  });

  return {
    billableHours: round2(billableHours),
    opsHours: round2(opsHours),
    gross: round2(gross),
    missingRateMonthKeys: [...missingRateMonthKeys].sort(),
    monthKeysWithHours: [...monthKeysWithHours].sort(),
  };
}

/**
 * Given collectionGroup parent IDs ({ collectionName: Map<parentId, docCount> })
 * and the set of known users/{id} doc IDs, list parents that hold timesheet
 * data the dashboard can never see.
 */
export function detectOrphans(parentIdsByCollection, knownUserIds) {
  const orphans = new Map(); // parentId -> { parentId, collections: [], docCount }
  for (const [collectionName, parents] of Object.entries(parentIdsByCollection)) {
    for (const [parentId, docCount] of parents.entries()) {
      if (knownUserIds.has(parentId)) continue;
      if (!orphans.has(parentId)) {
        orphans.set(parentId, { parentId, collections: [], docCount: 0 });
      }
      const record = orphans.get(parentId);
      record.collections.push(collectionName);
      record.docCount += docCount;
    }
  }
  return [...orphans.values()].sort((a, b) => a.parentId.localeCompare(b.parentId));
}

const normalizeName = (s) =>
  String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

/**
 * Suggest a canonical users/{id} target for each orphaned parent ID.
 * Matching is conservative: exact normalized equality against user IDs,
 * names, and emails first; then single-candidate token overlap (e.g. a bare
 * last name "Ohta" -> "Michael Ohta"). Ambiguous token matches return
 * confidence 'none' — a human resolves those in the migration map.
 */
export function suggestOrphanMatches(orphanIds, users) {
  return orphanIds.map((orphanId) => {
    const norm = normalizeName(orphanId);

    const exact = users.find(
      (u) =>
        normalizeName(u.id) === norm ||
        normalizeName(u.name) === norm ||
        (u.email && normalizeName(u.email) === norm)
    );
    if (exact) {
      return { orphanId, suggestedTargetId: exact.id, confidence: 'exact-normalized' };
    }

    const orphanTokens = norm.split(' ').filter(Boolean);
    const tokenMatches = users.filter((u) => {
      const userTokens = normalizeName(u.name || u.id).split(' ').filter(Boolean);
      return orphanTokens.some((t) => userTokens.includes(t));
    });
    if (tokenMatches.length === 1) {
      return { orphanId, suggestedTargetId: tokenMatches[0].id, confidence: 'token' };
    }

    return { orphanId, suggestedTargetId: null, confidence: 'none' };
  });
}

/**
 * Classify one user's coverage for the audit window. Multiple flags can
 * apply (e.g. ORPHANED + MISSING_RATE); OK only when nothing is wrong.
 *
 *  MISSING      — zero billable+ops hours intersecting the window
 *  ORPHANED     — an orphaned parent ID suggests-maps to this user
 *  MISSING_RATE — window months with billable hours but no rate (exact or
 *                 backward fallback) — those hours bill at $0 in the app
 */
export function classifyUser({ windowStats: stats, orphanMatchesForUser = [] }) {
  const flags = [];
  const notes = [];

  if ((stats.billableHours || 0) === 0 && (stats.opsHours || 0) === 0) {
    flags.push('MISSING');
    notes.push('no billable/ops hours in window');
  }
  if (orphanMatchesForUser.length > 0) {
    flags.push('ORPHANED');
    notes.push(`orphaned data under: ${orphanMatchesForUser.map((o) => o.orphanId).join(', ')}`);
  }
  if ((stats.missingRateMonthKeys || []).length > 0) {
    flags.push('MISSING_RATE');
    notes.push(`no rate for: ${stats.missingRateMonthKeys.join(', ')}`);
  }
  if (flags.length === 0) {
    flags.push('OK');
  }

  return { flags, notes };
}

/** Render rows ([{...}]) as an aligned plain-text table using the given columns. */
export function formatTable(rows, columns) {
  const headers = columns.map((c) => c.header);
  const cells = rows.map((row) => columns.map((c) => String(c.value(row) ?? '')));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((r) => r[i].length))
  );
  const line = (parts) => parts.map((p, i) => p.padEnd(widths[i])).join('  ');
  return [
    line(headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...cells.map(line),
  ].join('\n');
}
