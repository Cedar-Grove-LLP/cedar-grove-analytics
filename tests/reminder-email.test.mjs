import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_ORDINALS,
  SAM_CC_EMAIL,
  DUE_DATE_PLACEHOLDER,
  buildReminderBody,
  resolveDueDateStr,
  buildReminderCcList,
} from '../src/utils/reminderEmail.mjs';
import { DEFAULT_PAYMENT_TERMS } from '../src/utils/paymentStatus.mjs';

// Local-time date constructor, matching invoicesCalc's addDays (setDate-based).
const ymd = (y, m, d) => new Date(y, m - 1, d);

// --- resolveDueDateStr: the [DUE DATE] regression -------------------------
// Bug history: the body read `inv.dueDate`, a field that never exists on
// invoice entries, so it always rendered the literal placeholder. The due date
// must instead be derived from Date Sent + the client's payment terms.

test('resolveDueDateStr: Net 15 client → Date Sent + 15, as M/D', () => {
  // June 20 + 15 days = July 5 (month rollover).
  assert.equal(resolveDueDateStr(ymd(2026, 6, 20), { paymentTerms: 15 }), '7/5');
});

test('resolveDueDateStr: Net 30 client → Date Sent + 30, as M/D', () => {
  // June 20 + 30 days = July 20.
  assert.equal(resolveDueDateStr(ymd(2026, 6, 20), { paymentTerms: 30 }), '7/20');
});

test('resolveDueDateStr: no matched client falls back to firm default terms', () => {
  const withDefault = resolveDueDateStr(ymd(2026, 6, 1), null);
  const explicit = resolveDueDateStr(ymd(2026, 6, 1), { paymentTerms: DEFAULT_PAYMENT_TERMS });
  assert.equal(withDefault, explicit);
});

test('resolveDueDateStr: client without paymentTerms falls back to firm default', () => {
  assert.equal(
    resolveDueDateStr(ymd(2026, 6, 1), { clientName: 'Acme' }),
    resolveDueDateStr(ymd(2026, 6, 1), { paymentTerms: DEFAULT_PAYMENT_TERMS }),
  );
});

test('resolveDueDateStr: placeholder ONLY when Date Sent is unparseable', () => {
  assert.equal(resolveDueDateStr(null, { paymentTerms: 15 }), DUE_DATE_PLACEHOLDER);
  // A real, parseable Date Sent must never produce the placeholder.
  assert.notEqual(resolveDueDateStr(ymd(2026, 6, 20), { paymentTerms: 15 }), DUE_DATE_PLACEHOLDER);
});

// --- buildReminderCcList: the dropped-CC regression -----------------------
// Bug history: reminder replies never read the original thread's Cc header, so
// Colin/Valery (CC'd on the invoice) were dropped. They must be preserved on
// every reminder, with Sam appended on the final one.

const ORIGINAL_CC = 'Colin <colin@cedargrovellp.com>, valery@cedargrovellp.com';

test('buildReminderCcList: preserves the original thread CC on the first reminder', () => {
  assert.deepEqual(buildReminderCcList(ORIGINAL_CC, 0), [
    'Colin <colin@cedargrovellp.com>',
    'valery@cedargrovellp.com',
  ]);
});

test('buildReminderCcList: does NOT add Sam before the final reminder', () => {
  assert.equal(buildReminderCcList(ORIGINAL_CC, 0).some((a) => a.includes(SAM_CC_EMAIL)), false);
  assert.equal(buildReminderCcList(ORIGINAL_CC, 1).some((a) => a.includes(SAM_CC_EMAIL)), false);
});

test('buildReminderCcList: appends Sam on the final reminder (stage 2+)', () => {
  const cc = buildReminderCcList(ORIGINAL_CC, 2);
  assert.ok(cc.includes(SAM_CC_EMAIL));
  // Original recipients survive alongside Sam.
  assert.ok(cc.includes('valery@cedargrovellp.com'));
  assert.deepEqual(buildReminderCcList(ORIGINAL_CC, 5), buildReminderCcList(ORIGINAL_CC, 2));
});

test('buildReminderCcList: does not add Sam twice if already CC\'d (case-insensitive)', () => {
  const already = `valery@cedargrovellp.com, ${SAM_CC_EMAIL.toUpperCase()}`;
  const cc = buildReminderCcList(already, 2);
  assert.equal(cc.filter((a) => a.toLowerCase().includes(SAM_CC_EMAIL)).length, 1);
});

test('buildReminderCcList: empty original CC → just Sam on the final reminder, else empty', () => {
  assert.deepEqual(buildReminderCcList('', 0), []);
  assert.deepEqual(buildReminderCcList(undefined, 1), []);
  assert.deepEqual(buildReminderCcList('', 2), [SAM_CC_EMAIL]);
});

test('buildReminderCcList: trims whitespace and drops empty fragments', () => {
  assert.deepEqual(buildReminderCcList('  a@x.com ,, b@x.com ', 0), ['a@x.com', 'b@x.com']);
});

test('buildReminderCcList: respects a configurable/blank Sam address', () => {
  // Empty samCcEmail → no CC appended even on the final reminder.
  assert.deepEqual(buildReminderCcList('', 2, ''), []);
});

// --- buildReminderBody: due date is interpolated, not left as placeholder --

const BODY_ARGS = {
  greeting: 'Hi Kristine',
  invoiceMonthLabel: 'June',
  dueDateStr: '7/5',
  senderFirstName: 'Noah',
};

test('buildReminderBody: first reminder interpolates the real due date', () => {
  const body = buildReminderBody(0, BODY_ARGS);
  assert.ok(body.includes('the June invoice, which was due on 7/5.'));
  assert.ok(body.includes('Hi Kristine'));
  assert.ok(body.trimEnd().endsWith('Noah'));
  // Regression guard: a resolved due date must never leave the placeholder.
  assert.ok(!body.includes(DUE_DATE_PLACEHOLDER));
});

test('buildReminderBody: second reminder uses the past-due wording', () => {
  const body = buildReminderBody(1, BODY_ARGS);
  assert.ok(body.includes('past due invoice'));
  assert.ok(body.includes('was due on 7/5.'));
});

test('buildReminderBody: third reminder (stage 2+) escalates and reuses for later stages', () => {
  const body = buildReminderBody(2, BODY_ARGS);
  assert.ok(body.includes('sent multiple reminders'));
  assert.ok(body.includes('due on 7/5'));
  assert.equal(buildReminderBody(9, BODY_ARGS), body);
});

test('REMINDER_ORDINALS labels the three stages', () => {
  assert.deepEqual(REMINDER_ORDINALS, ['1st', '2nd', '3rd']);
});
