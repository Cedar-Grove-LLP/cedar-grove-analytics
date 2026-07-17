/**
 * Registry of the Cedar Grove timesheet workbooks the verifier reads. Data
 * only — no IO, no Sheets client. Consumed by `sheetLayout.mjs` (to resolve
 * a workbook's year for generic tab-name parsing) and, outside this build,
 * by the live collector and coverage report so an unreachable book is
 * enumerated rather than silently omitted.
 *
 * `key` is the stable id used everywhere a workbook is referenced (subject.
 * workbookKey on a Divergence, TAB_MONTH_OVERRIDES lookups, EXPECTED_BLIND_
 * SPOTS matches) — kebab-case `{attorney-slug}-{year}`, or `firm-{year}` for
 * the firm-wide books.
 *
 * `userId` is a readable slug placeholder (kebab-case full name), not the
 * real Firestore users/{userId} doc id — this registry doesn't have live
 * credentials to resolve the real id, and the collector (out of scope for
 * this build) is expected to re-map it against `users/` before use.
 */

export const WORKBOOKS = Object.freeze([
  // ---- 2026 books --------------------------------------------------------
  { key: 'vanloon-2026', attorney: 'Colin van Loon', userId: 'colin-van-loon', year: 2026,
    spreadsheetId: '1vEXzO-9HVaqnrqPPhnwxra1Mm_lQ4sapFlymCsXchjg', tabRange: "'{tab}'!A1:AF600" },
  { key: 'agate-2026', attorney: 'Nick Agate', userId: 'nick-agate', year: 2026,
    spreadsheetId: '1_OShAn1_oHjKCNnLkvgDBFHbn44a-4IBjYDa-nyzlCk', tabRange: "'{tab}'!A1:AF600" },
  { key: 'skrodzka-2026', attorney: 'Martyna Skrodzka', userId: 'martyna-skrodzka', year: 2026,
    spreadsheetId: '1kx9EdqcflSgg6mKcHHSM-potVNqPcaoB5gtuu1-wTcI', tabRange: "'{tab}'!A1:AF600" },
  { key: 'wilson-2026', attorney: 'Paige Wilson', userId: 'paige-wilson', year: 2026,
    spreadsheetId: '1FHm83YubcJXjJnL0LXekzT55yf3Na7iKgTs_hqEUQd4', tabRange: "'{tab}'!A1:AF600" },
  { key: 'levin-2026', attorney: 'Michael Levin', userId: 'michael-levin', year: 2026,
    spreadsheetId: '1eR2tdKrsK-Dtrk5flAcKqWRL5z-PqpGhhwuIoW1Sy7w', tabRange: "'{tab}'!A1:AF600" },
  { key: 'popkin-2026', attorney: 'David Popkin', userId: 'david-popkin', year: 2026,
    spreadsheetId: '1arHZ9BINt5DBcwAxw8cfQnITNzr8Y3BeW8LQdIqFLFw', tabRange: "'{tab}'!A1:AF600" },
  { key: 'manning-2026', attorney: 'Molly Manning', userId: 'molly-manning', year: 2026,
    spreadsheetId: '1Nq--CGYW-umbxi_bQCrNlnj-z95ovnXYnX7mgLgUNhk', tabRange: "'{tab}'!A1:AF600" },
  { key: 'mcclure-2026', attorney: 'Sam McClure', userId: 'sam-mcclure', year: 2026,
    spreadsheetId: '1OVphjUzgUwwpRnmp0G53iyNYCQmRZJKCcQXNXJIjOSo', tabRange: "'{tab}'!A1:AF600" },
  { key: 'ohta-2026', attorney: 'Michael Ohta', userId: 'michael-ohta', year: 2026,
    spreadsheetId: '1MDoJ48EuESyNuCcg3ofBCQ1rk-G2PnR06bJI4hnIk-w', tabRange: "'{tab}'!A1:AF600" },
  { key: 'uscanga-2026', attorney: 'Valery Uscanga', userId: 'valery-uscanga', year: 2026,
    spreadsheetId: '1d8PZeic2-PVZQmE9sIbkUwkN4dJu6RlzNdgdNZH-ovQ', tabRange: "'{tab}'!A1:AF600" },
  { key: 'munoz-2026', attorney: 'Munoz', userId: 'munoz', year: 2026,
    spreadsheetId: '1JpE6XBH7LYL0yDITQPT1bx7s4uqd6BkoggMml9rxF2I', tabRange: "'{tab}'!A1:AF600" },

  // ---- 2025 books ---------------------------------------------------------
  { key: 'vanloon-2025', attorney: 'Colin van Loon', userId: 'colin-van-loon', year: 2025,
    spreadsheetId: '1W_XyxSVtOO2Rx0hSRRkp7E1imn-nrEX1YmeW_OOGCH0', tabRange: "'{tab}'!A1:AF600" },
  { key: 'mcclure-2025', attorney: 'Sam McClure', userId: 'sam-mcclure', year: 2025,
    spreadsheetId: '14cWOVYhL7HOvY9Iek3fW5J_Zqwh_1gczvG8cofc4ytY', tabRange: "'{tab}'!A1:AF600" },
  { key: 'ohta-2025', attorney: 'Michael Ohta', userId: 'michael-ohta', year: 2025,
    spreadsheetId: '14RqTnP6l47eVndacpdCYfvE-1-Z_sV4qUYLAghyvKxE', tabRange: "'{tab}'!A1:AF600" },
  { key: 'uscanga-2025', attorney: 'Valery Uscanga', userId: 'valery-uscanga', year: 2025,
    spreadsheetId: '1arvyvuzZMyVvTjelA4mLvTYs2EYxrQ9oDQAI6_VB8kw', tabRange: "'{tab}'!A1:AF600" },

  // ---- known 403s (2025 books never shared with the service account) ------
  { key: 'weekes-2025', attorney: 'Miika Weekes', userId: 'miika-weekes', year: 2025,
    spreadsheetId: '1_Xw8lR2nUKPC4UoCoEdtX6KkRfJrrXkQBUOf6_cBpnc', tabRange: "'{tab}'!A1:AF600" },
  { key: 'duble-2025', attorney: 'Andrew Duble', userId: 'andrew-duble', year: 2025,
    spreadsheetId: '1a-cvokVdIcSm9D5vGFLFcxxt4O0QqfR_nNSKjh3Taxg', tabRange: "'{tab}'!A1:AF600" },
  { key: 'popkin-2025', attorney: 'David Popkin', userId: 'david-popkin', year: 2025,
    spreadsheetId: '1-MqUVw3_HHzDvAaebt5d_u9IFH7nx_eeCqEYWdyqCvQ', tabRange: "'{tab}'!A1:AF600" },
  { key: 'agate-2025', attorney: 'Nick Agate', userId: 'nick-agate', year: 2025,
    spreadsheetId: '1oXQbRb8fJE8OSSI9TGS593xWhBOGbyNSGlFYtSjMP7A', tabRange: "'{tab}'!A1:AF600" },

  // ---- firm-wide books ------------------------------------------------------
  { key: 'firm-2026', attorney: null, userId: null, year: 2026,
    spreadsheetId: '1Qkqc4zsqMzP9lN4qTYiDpdJEbQAWQq88j3p23SVxNq8', tabRange: "'{tab}'!A1:AF600" },
  { key: 'firm-2025', attorney: null, userId: null, year: 2025,
    spreadsheetId: '1IJwvMOcE2dmneUrQ2hx634NxM7Utvr9HpfV8EUxSzrE', tabRange: "'{tab}'!A1:AF600" },
]);

/**
 * Books confirmed unreachable (403 PERMISSION_DENIED) as of the date in
 * `since` — not shared Viewer with the service account. Kept separate from
 * WORKBOOKS (rather than a boolean flag on each entry) so `ruleCoverage`'s
 * `allowlisted` check and the coverage report both read from one small list
 * instead of scanning every workbook for a flag.
 */
export const EXPECTED_BLIND_SPOTS = Object.freeze([
  { workbookKey: 'weekes-2025', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
  { workbookKey: 'duble-2025', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
  { workbookKey: 'popkin-2025', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
  { workbookKey: 'agate-2025', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
  { workbookKey: 'firm-2025', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
  { workbookKey: 'munoz-2026', reason: '403 PERMISSION_DENIED — not shared with SA', since: '2026-07-15' },
]);
