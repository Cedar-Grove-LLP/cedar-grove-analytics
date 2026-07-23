// Browser CSV download wrapper around the pure buildCsv (see buildCsv.mjs).
import { buildCsv } from './buildCsv.mjs';

export { buildCsv };

// Build and trigger a browser download of a CSV file from a header row and
// an array of row arrays. Every field is escaped — wrapped in double quotes
// with internal quotes doubled — so commas, quotes, and newlines inside a
// value can't break the column layout. Cells may be strings or numbers;
// null/undefined become empty.
export function downloadCSV(filename, headers, rows) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
