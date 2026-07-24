// Pure CSV string builder (Node-importable, tested by tests/build-csv.test.mjs).
// Browser download lives in csv.js, which consumes and re-exports this.

// Build a CSV string from a header row and an array of row arrays. Every
// field is escaped — wrapped in double quotes with internal quotes doubled —
// so commas, quotes, and newlines inside a value can't break the column
// layout. Cells may be strings or numbers; null/undefined become empty.
export function buildCsv(headers, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}
