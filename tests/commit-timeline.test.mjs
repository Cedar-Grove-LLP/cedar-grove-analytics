import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTH_NAMES_FULL,
  MONTH_NAMES_ABBR,
  FEATURE_RE,
  FIX_RE,
  CATEGORY_RULES,
  classify,
  commitType,
  annotateCommit,
  sortByDateDesc,
  buildTree,
  pickMonthHeadlines,
} from '../src/utils/commitTimeline.mjs';

// Minimal commit fixture matching the API/hook shape: { sha, date, author,
// message, isMerge }.
const mk = (message, over = {}) => ({
  sha: 'sha0000',
  date: '2026-03-15T00:00:00Z',
  author: 'Test Author',
  message,
  isMerge: false,
  ...over,
});

// ------------------------------------------------------------- classify()

test('classify: merges always win, regardless of message content', () => {
  assert.equal(classify(mk('Merge pull request #19 from x/y', { isMerge: true })), 'Merges & PRs');
  // A merge whose message would otherwise hit Practice & Roster / Feature-ish
  // wording must still be a merge — isMerge is checked before any keyword.
  assert.equal(
    classify(mk('Add admin-only Practice Composition tab for billable hours breakdown', { isMerge: true })),
    'Merges & PRs',
  );
});

test('classify: "Add admin-only Practice Composition..." is Practice & Roster, not Security & Auth', () => {
  // Regression pin: this exact string contains "admin", which would match the
  // Security & Auth rule if Practice & Roster didn't come first in rule order.
  assert.equal(
    classify(mk('Add admin-only Practice Composition tab for billable hours breakdown')),
    'Practice & Roster',
  );
});

test('classify: Practice & Roster covers seniority, activation date, and roster wording', () => {
  assert.equal(classify(mk('Auto-derive attorney activationDate from first activity month')), 'Practice & Roster');
  assert.equal(classify(mk('Add attorney activation date to gate roster visibility and date ranges')), 'Practice & Roster');
  assert.equal(classify(mk('List staff in seniority order across the dashboard')), 'Practice & Roster');
  assert.equal(classify(mk('Address code review: extend seniority order to Downloads + harden sort')), 'Practice & Roster');
});

test('classify: rule order lets earlier domains win over generic later keywords', () => {
  // "client" (rule 3) beats "adjustment"/"payment" (rule 4, Billing).
  assert.equal(classify(mk('Reflect McClure adjustments on client-detail and Overview pages')), 'Clients');
  assert.equal(classify(mk('Replace Ideal/Non-Ideal/TBD tags with calculated Payment Status tags')), 'Clients');
  // "reminder" (Billing, rule 4) beats "template" (Setup & Platform, rule 13).
  assert.equal(classify(mk('Update email reminder template')), 'Billing & Invoices');
});

test('classify: "Add PR template..." lands in Setup & Platform', () => {
  assert.equal(
    classify(mk('Add PR template with What-changed table and testing checklists')),
    'Setup & Platform',
  );
});

test('classify: spot-checks across the rest of the category table', () => {
  const cases = [
    ['Add OOO/holiday-aware utilization target pro-rating', 'Utilization & Targets'],
    ['Add mark paid option for invoices', 'Billing & Invoices'],
    ['Add McClure timesheet "Adjustment ($)" column support', 'Billing & Invoices'],
    ['Add document downloads tab', 'Document Downloads'],
    ['Add matter management page', 'Matters'],
    ['Add transaction sync button', 'Transactions'],
    ['Add zoomable sunburst chart to ops tab', 'Ops'],
    ['Add calculation tooltip system: registry, CalcTooltip, Overview integration', 'Calculations & Tooltips'],
    ['Hide Miika when no entries', 'Team & Attorneys'],
    ['Refactor to use updated firebase schema', 'Data & Sync'],
    ['Harden /api/sync-transactions with Firebase ID-token auth (SEC-001)', 'Transactions'],
    ['Update auth to limit access for cedargrovellp only', 'Security & Auth'],
    ['Fix build error', 'Setup & Platform'],
    ['Make Tech Team a dashboard tab; accessible, uncapped, categorized timeline', 'Setup & Platform'],
    ['Add /tech-team route with dynamic commit-history timeline', 'Setup & Platform'],
    ['Update time frame selection', 'UI & Styling'],
    ['Update styling', 'UI & Styling'],
  ];
  for (const [message, expected] of cases) {
    assert.equal(classify(mk(message)), expected, message);
  }
});

test('classify: Clients rule word-bounds "ideal" (no mid-word false match) but still catches the isIdeal field name', () => {
  // Regression pin for an alternation-precedence fix: a bare, unparenthesized
  // `\bclient|ideal|\bquiet` middle alternative had no word boundary at all,
  // so it would match "ideal" as a mid-word substring (e.g. hypothetically
  // "unidealistic"). Confirm that's now excluded...
  assert.equal(classify(mk('Refactor unidealistic sorting logic')), 'Setup & Platform');
  // ...while the real, recurring "isIdeal" identifier (the legacy Firestore
  // field name for client ideal-fit rating) is still explicitly special-cased
  // to Clients, since it has no word boundary before "ideal" either but IS
  // genuinely a client-related term in this codebase.
  assert.equal(classify(mk('Map isIdeal "Yes"/"No"/"TBD" strings to ratings')), 'Clients');
  assert.equal(classify(mk('Surface client Ideal/Non-Ideal/TBD rating from synced data')), 'Clients');
});

test('classify: unmatched messages fall back to Other', () => {
  assert.equal(classify(mk('zzz nonsense qqq')), 'Other');
});

test('CATEGORY_RULES: Practice & Roster is ordered before Security & Auth, Team & Attorneys, and UI & Styling', () => {
  const idx = (label) => CATEGORY_RULES.findIndex(([l]) => l === label);
  const practiceIdx = idx('Practice & Roster');
  assert.ok(practiceIdx >= 0);
  assert.ok(practiceIdx < idx('Security & Auth'));
  assert.ok(practiceIdx < idx('Team & Attorneys'));
  assert.ok(practiceIdx < idx('UI & Styling'));
});

// ------------------------------------------------------------ commitType()

test('commitType: merge beats every text-based rule, even Feature/Fix-shaped messages', () => {
  assert.deepEqual(commitType(mk('Add something', { isMerge: true })), {
    label: 'Merge',
    cls: 'bg-meta-light text-meta-text',
  });
  assert.deepEqual(commitType(mk('Fix something', { isMerge: true })), {
    label: 'Merge',
    cls: 'bg-meta-light text-meta-text',
  });
});

test('commitType: Feature, Fix, and Update shapes', () => {
  assert.deepEqual(commitType(mk('Add a widget')), {
    label: 'Feature',
    cls: 'bg-status-success-light text-status-success-text',
  });
  assert.deepEqual(commitType(mk('Fixed the widget')), {
    label: 'Fix',
    cls: 'bg-status-warning-light text-status-warning-text',
  });
  assert.deepEqual(commitType(mk('Refactor the widget')), {
    label: 'Update',
    cls: 'bg-gray-100 text-gray-700',
  });
});

test('commitType: FEATURE_RE/FIX_RE only match at the start of the message', () => {
  assert.equal(FEATURE_RE.test('Add a widget'), true);
  assert.equal(FEATURE_RE.test('We should add a widget'), false);
  assert.equal(FIX_RE.test('Fix the widget'), true);
  assert.equal(FIX_RE.test('We should fix the widget'), false);
});

// ----------------------------------------------------------- annotateCommit()

test('annotateCommit: attaches category + type once, matching classify()/commitType()', () => {
  const c = mk('Add a widget');
  const annotated = annotateCommit(c);
  assert.equal(annotated.category, classify(c));
  assert.deepEqual(annotated.type, commitType(c));
  // Original fields preserved.
  assert.equal(annotated.sha, c.sha);
  assert.equal(annotated.message, c.message);
});

test('buildTree: reuses pre-annotated .category/.type instead of reclassifying', () => {
  // A commit whose message would normally classify as "Team & Attorneys" /
  // "Feature", but is pre-annotated with different values — buildTree must
  // trust the pre-annotated fields (the efficiency contract annotateCommit()
  // exists for), not silently reclassify and discard them.
  const raw = mk('Add attorney rate update', { sha: 'preannot1' });
  const preAnnotated = { ...raw, category: 'Custom Bucket', type: { label: 'Update', cls: 'x' } };
  const tree = buildTree([preAnnotated], 'project');
  assert.equal(tree[0].key, 'Custom Bucket');
  assert.equal(tree[0].featureCount, 0); // type.label is 'Update', not 'Feature'
});

// --------------------------------------------------------------- buildTree()

// Shared fixture: 3 months (incl. one undated bucket), mixed categories/types.
//
// The undated commit uses date: null, matching the real shape the API emits
// (src/app/api/commit-history/route.js: `date: authorMeta.date ||
// committerMeta.date || null`) when a commit has no author/committer date.
// `new Date(null).getTime()` is 0 (epoch, a "valid" date) rather than NaN, so
// buildTree explicitly checks `c.date` truthiness before parsing — see the
// dedicated regression test below for both the null and undefined cases.
const treeCommits = [
  mk('Add attorney rate update', { sha: 'aaa1111', date: '2026-03-10T00:00:00Z' }), // Mar'26, Team & Attorneys, Feature
  mk('Fix client billing issue', { sha: 'bbb2222', date: '2026-03-05T00:00:00Z' }), // Mar'26, Clients, Fix
  mk('Update ops dashboard', { sha: 'ccc3333', date: '2026-02-20T00:00:00Z' }), // Feb'26, Ops, Update
  mk('Merge pull request #4 from x/y', { sha: 'ddd4444', date: '2026-02-25T00:00:00Z', isMerge: true }), // Feb'26, Merges & PRs
  mk('zzz nonsense qqq', { sha: 'eee5555', date: null }), // Undated, Other
  mk('Update ops chart', { sha: 'fff6666', date: '2026-02-10T00:00:00Z' }), // Feb'26, Ops, Update (older)
];

test('buildTree (groupBy=month): primary groups sorted newest-first, undated last', () => {
  const tree = buildTree(treeCommits, 'month');
  assert.deepEqual(tree.map((p) => p.key), ['2026-03', '2026-02', '0000-00']);

  const march = tree[0];
  assert.equal(march.label, 'March 2026');
  assert.equal(march.short, "Mar '26");
  assert.equal(march.count, 2);
  assert.equal(march.featureCount, 1); // only "Add attorney rate update"

  const feb = tree[1];
  assert.equal(feb.label, 'February 2026');
  assert.equal(feb.short, "Feb '26");
  assert.equal(feb.count, 3);
  assert.equal(feb.featureCount, 0);

  const undated = tree[2];
  assert.equal(undated.label, 'Undated');
  assert.equal(undated.short, '—');
  assert.equal(undated.count, 1);
});

test('buildTree (groupBy=month): secondary (category) groups sorted by count desc, ties alphabetical', () => {
  const tree = buildTree(treeCommits, 'month');
  const march = tree.find((p) => p.key === '2026-03');
  // Both categories have 1 commit each → alphabetical: Clients before Team & Attorneys.
  assert.deepEqual(march.children.map((c) => c.key), ['Clients', 'Team & Attorneys']);

  const feb = tree.find((p) => p.key === '2026-02');
  // Ops has 2 commits, Merges & PRs has 1 → count desc wins.
  assert.deepEqual(feb.children.map((c) => ({ key: c.key, count: c.count })), [
    { key: 'Ops', count: 2 },
    { key: 'Merges & PRs', count: 1 },
  ]);

  const opsGroup = feb.children.find((c) => c.key === 'Ops');
  // Commits within a leaf group sort newest-first.
  assert.deepEqual(opsGroup.commits.map((c) => c.sha), ['ccc3333', 'fff6666']);
});

test('buildTree (groupBy=project): primary groups sorted by count desc, ties alphabetical', () => {
  const tree = buildTree(treeCommits, 'project');
  assert.deepEqual(tree.map((p) => p.key), [
    'Ops', // count 2
    'Clients', 'Merges & PRs', 'Other', 'Team & Attorneys', // count 1, alphabetical
  ]);

  const ops = tree[0];
  assert.equal(ops.count, 2);
  // Secondary groups (months) sorted newest-first; both Ops commits share Feb'26.
  assert.deepEqual(ops.children.map((c) => c.key), ['2026-02']);
  assert.deepEqual(ops.children[0].commits.map((c) => c.sha), ['ccc3333', 'fff6666']);
});

test('buildTree (groupBy=project): the undated bucket surfaces as "Undated" under Other', () => {
  const tree = buildTree(treeCommits, 'project');
  const other = tree.find((p) => p.key === 'Other');
  assert.ok(other);
  assert.deepEqual(other.children.map((c) => ({ key: c.key, label: c.label })), [
    { key: '0000-00', label: 'Undated' },
  ]);
});

test('buildTree: month labels use the shared MONTH_NAMES_FULL/ABBR arrays', () => {
  assert.equal(MONTH_NAMES_FULL[2], 'March');
  assert.equal(MONTH_NAMES_ABBR[2], 'Mar');
  assert.equal(MONTH_NAMES_FULL.length, 12);
  assert.equal(MONTH_NAMES_ABBR.length, 12);
});

test('buildTree: a null date (the real API shape for a dateless commit) lands in Undated, not "January 1970"', () => {
  // Regression pin: new Date(null) is epoch (1970-01-01), NOT NaN, so a naive
  // `!Number.isNaN(new Date(c.date).getTime())` validity check misclassifies
  // it as a real date. Cover both null (the API's actual shape) and undefined.
  const tree = buildTree([mk('No date at all', { sha: 'null0001', date: null })], 'month');
  assert.deepEqual(tree.map((p) => p.key), ['0000-00']);
  assert.equal(tree[0].label, 'Undated');
  assert.equal(tree[0].short, '—');

  const treeUndef = buildTree([mk('Also no date', { sha: 'undef001', date: undefined })], 'month');
  assert.deepEqual(treeUndef.map((p) => p.key), ['0000-00']);
  assert.equal(treeUndef[0].label, 'Undated');
});

test('sortByDateDesc: newest first, treats null date as epoch (oldest)', () => {
  const a = mk('a', { date: '2026-01-01T00:00:00Z' });
  const b = mk('b', { date: '2026-06-01T00:00:00Z' });
  const undated = mk('u', { date: null });
  assert.deepEqual([a, b, undated].sort(sortByDateDesc).map((c) => c.message), ['b', 'a', 'u']);
});

// ---------------------------------------------------------- pickMonthHeadlines()

test('pickMonthHeadlines: prioritizes Feature > Fix > Update, ties newest-first', () => {
  const commits = [
    mk('Update minor thing', { sha: 'u1', date: '2026-03-01T00:00:00Z' }),
    mk('Add big feature', { sha: 'f1', date: '2026-03-05T00:00:00Z' }),
    mk('Fix a bug', { sha: 'x1', date: '2026-03-10T00:00:00Z' }),
    mk('Add another feature', { sha: 'f2', date: '2026-03-20T00:00:00Z' }),
    mk('Add earliest feature', { sha: 'f0', date: '2026-03-02T00:00:00Z' }),
  ];
  const headlines = pickMonthHeadlines(commits, 6);
  assert.deepEqual(headlines.map((h) => h.sha), ['f2', 'f1', 'f0', 'x1', 'u1']);
  assert.deepEqual(headlines.map((h) => h.milestone), [true, true, true, false, false]);
});

test('pickMonthHeadlines: excludes merges even when they would otherwise sort first', () => {
  const commits = [
    mk('Merge pull request #9', { sha: 'm1', date: '2026-03-25T00:00:00Z', isMerge: true }),
    mk('Add a feature', { sha: 'f1', date: '2026-03-01T00:00:00Z' }),
  ];
  const headlines = pickMonthHeadlines(commits, 6);
  assert.equal(headlines.length, 1);
  assert.equal(headlines[0].sha, 'f1');
});

test('pickMonthHeadlines: respects the max parameter (default 6)', () => {
  const commits = Array.from({ length: 10 }, (_, i) =>
    mk(`Add feature ${i}`, { sha: `s${i}`, date: `2026-03-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  assert.equal(pickMonthHeadlines(commits).length, 6); // default max
  assert.equal(pickMonthHeadlines(commits, 2).length, 2);
  assert.equal(pickMonthHeadlines(commits, 2)[0].sha, 's9'); // newest of the ties
});

test('pickMonthHeadlines: truncates long first lines to ~46 chars with an ellipsis', () => {
  const long = 'Add automatic retry logic for flaky GitHub API pagination calls';
  const [headline] = pickMonthHeadlines([mk(long, { sha: 'f1' })], 1);
  assert.equal(headline.text, 'Add automatic retry logic for flaky GitHub AP…');
  assert.equal(headline.text.length, 46);
});

test('pickMonthHeadlines: short first lines pass through untouched', () => {
  const short = 'Fix login bug';
  const [headline] = pickMonthHeadlines([mk(short, { sha: 'x1' })], 1);
  assert.equal(headline.text, short);
});

test('pickMonthHeadlines: handles empty/undefined input safely', () => {
  assert.deepEqual(pickMonthHeadlines([]), []);
  assert.deepEqual(pickMonthHeadlines(undefined), []);
});
