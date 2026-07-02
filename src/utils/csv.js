// Build and trigger a browser download of a CSV file from a header row and
// an array of row arrays. Every field is escaped — wrapped in double quotes
// with internal quotes doubled — so commas, quotes, and newlines inside a
// value can't break the column layout. Cells may be strings or numbers;
// null/undefined become empty.
export function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
