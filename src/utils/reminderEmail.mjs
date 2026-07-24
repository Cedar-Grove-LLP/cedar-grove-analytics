// Pure builders for the invoice payment-reminder emails drafted from the admin
// Invoices page (src/components/AdminInvoices.jsx). Extracted from the component
// so the body copy, due-date rendering, and CC handling can be unit-tested in
// Node without the Firebase client SDK. See tests/reminder-email.test.mjs.
//
// The escalation cadence itself (when the 1st/2nd/3rd fire) lives in
// invoicesCalc.mjs; this module only builds the message once a reminder is due.

import { invoiceDueDate } from './invoicesCalc.mjs';
import { DEFAULT_PAYMENT_TERMS } from './paymentStatus.mjs';

// Ordinal labels for the three sequential reminders (index by stage, capped at 2).
export const REMINDER_ORDINALS = ['1st', '2nd', '3rd'];

// Sam is CC'd on the third/final reminder per the Invoice Reminders System doc
// ("Please CC Sam on the third reminder email"). Appended on top of the original
// thread's CC list (Colin, Valery, …) for stage 2+ reminders.
export const SAM_CC_EMAIL = 'sam@cedargrovellp.com';

// Placeholder rendered only when the due date genuinely can't be resolved
// (Date Sent unparseable). A real invoice should never surface this.
export const DUE_DATE_PLACEHOLDER = '[DUE DATE]';

// Sequential reminder email bodies, one per escalation stage (see the Invoice
// Reminders System doc — the single source of truth for this copy):
//   stage 0 → First reminder   (~16 days after the invoice, or day 31 for Net 30)
//   stage 1 → Second reminder  (14 days after the first)
//   stage 2+ → Third reminder  (final; CC Sam) — reused for any further nudges
// `stage` is the count of reminders already drafted for this invoice, so the
// body returned is the NEXT one to send.
export function buildReminderBody(stage, { greeting, invoiceMonthLabel, dueDateStr, senderFirstName }) {
  if (stage <= 0) {
    return [
      `${greeting}, hope you are doing well.`,
      ``,
      `I wanted to follow up on the status of your payment for the ${invoiceMonthLabel} invoice, which was due on ${dueDateStr}.`,
      ``,
      `Please let us know if you have already processed the payment. We may have missed it on our end. Otherwise, we ask that you do so at your earliest convenience.`,
      ``,
      `As always, please let us know if you have any questions.`,
      ``,
      `Best,`,
      senderFirstName,
    ].join('\n');
  }
  if (stage === 1) {
    return [
      `${greeting},`,
      `Following up on our note below regarding your past due invoice. The payment for the ${invoiceMonthLabel} invoice was due on ${dueDateStr}.`,
      ``,
      `Please let us know if you have already processed the payment and we will be sure to check our records again.`,
      ``,
      `Otherwise, we ask that you send payment as soon as possible.`,
      ``,
      `Best,`,
      senderFirstName,
    ].join('\n');
  }
  return [
    `${greeting},`,
    `Following up regarding the ${invoiceMonthLabel} invoice. The payment was due on ${dueDateStr} and we have sent multiple reminders but have not received the payment.`,
    ``,
    `Please provide us with an update on the timing of your payment. We ask that you send the amount due no later than the end of this week.`,
    ``,
    `Best,`,
    senderFirstName,
  ].join('\n');
}

/**
 * Render the invoice due date as "M/D" for the reminder body.
 *
 * Invoice entries carry no stored `dueDate`, so it's derived from Date Sent +
 * the client's payment terms (Net 15/30). Falls back to the firm default terms
 * when the client can't be matched, and to DUE_DATE_PLACEHOLDER only when Date
 * Sent itself is unparseable.
 *
 * @param {Date|null} dateSentParsed  parsed Date Sent, or null if unparseable
 * @param {object}    [matchedClient] the client record (for `paymentTerms`)
 * @returns {string}  "M/D" or DUE_DATE_PLACEHOLDER
 */
export function resolveDueDateStr(dateSentParsed, matchedClient) {
  const terms = matchedClient?.paymentTerms ?? DEFAULT_PAYMENT_TERMS;
  const due = dateSentParsed ? invoiceDueDate(dateSentParsed, terms) : null;
  return due ? `${due.getMonth() + 1}/${due.getDate()}` : DUE_DATE_PLACEHOLDER;
}

/**
 * Build the CC recipient list for a reminder reply.
 *
 * Preserves whoever was CC'd on the original invoice thread (e.g. Colin and
 * Valery) on every reminder, and appends Sam on the final reminder (stage 2+)
 * once his address is configured. Deduped case-insensitively so a name that was
 * already CC'd isn't added twice.
 *
 * @param {string}  originalCc        raw `Cc` header from the original thread
 * @param {number}  stage             reminders already sent (0-based)
 * @param {string}  [samCcEmail]      address to append on the final reminder
 * @returns {string[]} trimmed CC addresses (possibly empty)
 */
export function buildReminderCcList(originalCc, stage, samCcEmail = SAM_CC_EMAIL) {
  const ccList = originalCc
    ? originalCc.split(',').map((a) => a.trim()).filter(Boolean)
    : [];
  if (
    stage >= 2 &&
    samCcEmail &&
    !ccList.some((a) => a.toLowerCase().includes(samCcEmail.toLowerCase()))
  ) {
    ccList.push(samCcEmail);
  }
  return ccList;
}
