/**
 * Phantom 83(b) template-entry detection.
 *
 * Empty 83(b) election template blocks have produced fabricated Firestore
 * entries whose flat fees are the sync loop's 1-based counter (1, 2, ... N).
 * Real election fees are around $250, so a complete ordered counter sequence
 * with at least two entries is a strong signature of this sync defect.
 *
 * Pure module — no React/Firebase imports; Node-importable.
 */

/**
 * Detect a strict ordered 1..N flat-fee sequence caused by an empty template.
 *
 * @param {Array} entries 83(b) entry objects with string or number flatFee values
 * @returns {{isPhantom:boolean, affectedRows:number}}
 */
export function detectPhantomTemplateEntries(entries) {
  const isPhantom = entries.length >= 2
    && entries.every((entry, index) => Number(entry.flatFee) === index + 1);

  return {
    isPhantom,
    affectedRows: isPhantom ? entries.length : 0,
  };
}
