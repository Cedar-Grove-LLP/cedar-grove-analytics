/* eslint-disable no-console */
/**
 * Seed rateCard/all in Firestore from the 2026 rate sheet.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat path/to/serviceAccountKey.json)" \
 *     node scripts/seed-rate-card.js
 *
 * Idempotent — overwrites the single rateCard/all document.
 */

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

// rank defines progression order. Predictive model bumps rank by 1 at each
// Q2 (Apr 1) and Q4 (Oct 1) boundary, capped at the highest rank (P2/B).
const levels = [
  { rank: 0,  level: "A1", tier: "A", clientRate: 380.0, attorneyRate: 170.0, colinRate: null,   estAnnualSalary: 204000, cravathTotalComp: 251000 },
  { rank: 1,  level: "A1", tier: "B", clientRate: 400.0, attorneyRate: 180.0, colinRate: null,   estAnnualSalary: 216000, cravathTotalComp: null },
  { rank: 2,  level: "A2", tier: "A", clientRate: 430.0, attorneyRate: 190.0, colinRate: null,   estAnnualSalary: 228000, cravathTotalComp: 275000 },
  { rank: 3,  level: "A2", tier: "B", clientRate: 450.0, attorneyRate: 200.0, colinRate: null,   estAnnualSalary: 240000, cravathTotalComp: null },
  { rank: 4,  level: "C1", tier: "A", clientRate: 460.0, attorneyRate: 250.0, colinRate: null,   estAnnualSalary: 300000, cravathTotalComp: 332500 },
  { rank: 5,  level: "C1", tier: "B", clientRate: 480.0, attorneyRate: 260.0, colinRate: null,   estAnnualSalary: 312000, cravathTotalComp: null },
  { rank: 6,  level: "C2", tier: "A", clientRate: 500.0, attorneyRate: 270.0, colinRate: null,   estAnnualSalary: 324000, cravathTotalComp: 405000 },
  { rank: 7,  level: "C2", tier: "B", clientRate: 510.0, attorneyRate: 280.0, colinRate: null,   estAnnualSalary: 336000, cravathTotalComp: null },
  { rank: 8,  level: "C3", tier: "A", clientRate: 530.0, attorneyRate: 290.0, colinRate: null,   estAnnualSalary: 348000, cravathTotalComp: 480000 },
  { rank: 9,  level: "C3", tier: "B", clientRate: 550.0, attorneyRate: 300.0, colinRate: null,   estAnnualSalary: 360000, cravathTotalComp: null },
  { rank: 10, level: "C4", tier: "A", clientRate: 570.0, attorneyRate: 312.5, colinRate: null,   estAnnualSalary: 375000, cravathTotalComp: 520000 },
  { rank: 11, level: "C4", tier: "B", clientRate: 600.0, attorneyRate: 325.0, colinRate: null,   estAnnualSalary: 390000, cravathTotalComp: null },
  { rank: 12, level: "C5", tier: "A", clientRate: 620.0, attorneyRate: 337.5, colinRate: null,   estAnnualSalary: 405000, cravathTotalComp: 560000 },
  { rank: 13, level: "C5", tier: "B", clientRate: 640.0, attorneyRate: 350.0, colinRate: 373.75, estAnnualSalary: 420000, cravathTotalComp: null },
  { rank: 14, level: "C6", tier: "A", clientRate: 660.0, attorneyRate: 362.5, colinRate: 390.0,  estAnnualSalary: 435000, cravathTotalComp: 575000 },
  { rank: 15, level: "C6", tier: "B", clientRate: 690.0, attorneyRate: 375.0, colinRate: 406.25, estAnnualSalary: 450000, cravathTotalComp: null },
  { rank: 16, level: "P1", tier: "A", clientRate: 700.0, attorneyRate: 387.5, colinRate: 422.5,  estAnnualSalary: null,   cravathTotalComp: null },
  { rank: 17, level: "P1", tier: "B", clientRate: 730.0, attorneyRate: 400.0, colinRate: 455.0,  estAnnualSalary: null,   cravathTotalComp: null },
  { rank: 18, level: "P2", tier: "A", clientRate: 760.0, attorneyRate: 420.0, colinRate: 471.25, estAnnualSalary: null,   cravathTotalComp: null },
  { rank: 19, level: "P2", tier: "B", clientRate: 800.0, attorneyRate: 440.0, colinRate: 487.5,  estAnnualSalary: null,   cravathTotalComp: null },
];

const notes = [
  "A1 is equivalent to a Cravath first year.",
  "Leveling at each row is expected but not guaranteed every 6 months (quasi-lockstep).",
  "Leveling opportunity occurs after comprehensive performance reviews during the Q2 and Q4 on-sites, with new rates effective the following month. (E.g., for an April on-site the new rate is effective 5/1).",
  "For outstanding, sustained performance (book prize) with a very sharp growth curve, discretionary extra leveling may occur at the end of any quarter. This is not expected for anyone at any time.",
  "Semi-annual review cycles and leveling ensures the right balance of frequent forward momentum and meaningful feedback (unlike Big Law, annual lockstep). Discretionary leveling can reward incredible performance (again unlike Big Law).",
  "Partners (P1/P2) bill fewer client hours but receive profit share; estAnnualSalary is variable.",
  "estAnnualSalary assumes 1200 billed hours.",
];

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var required");
  }

  const app =
    getApps().length === 0
      ? initializeApp({
          credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
        })
      : getApps()[0];

  const db = getFirestore(app);

  const payload = {
    levels,
    notes,
    source: "Cedar Grove LLP - Invoices (2026) - Rate Sheet",
    year: 2026,
    lastSyncedAt: FieldValue.serverTimestamp(),
  };

  await db.collection("rateCard").doc("all").set(payload);

  console.log(`Wrote rateCard/all with ${levels.length} level entries.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
