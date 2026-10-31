type Row = Record<string, string | number>;

// A cell starting with one of these runs as a formula when the file is opened in Excel or Sheets. Borrower names and
// addresses come from outside, so text cells are made safe. Plain numbers stay numbers.
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: string | number) {
  if (typeof value === "number") return String(value);
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Row[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.map(cell).join(","), ...rows.map((row) => headers.map((header) => cell(row[header] ?? "")).join(","))].join("\r\n");
}

export function downloadCsv(name: string, rows: Row[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
