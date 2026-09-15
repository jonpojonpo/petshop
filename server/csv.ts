import type { Receipt } from "./types.ts";

type Column =
  | "runId"
  | "petId"
  | "model"
  | "billing"
  | "status"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "marginalCostUsd";

const COLUMNS: Column[] = [
  "runId",
  "petId",
  "model",
  "billing",
  "status",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "marginalCostUsd",
];

// Leading characters that make a text field look like a formula to spreadsheets.
const FORMULA_PREFIXES = new Set(["=", "+", "@", "-"]);

function needsQuotes(text: string): boolean {
  return (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  );
}

function toField(value: unknown): string {
  // null / undefined render as an empty field.
  if (value === null || value === undefined) {
    return "";
  }
  // Numbers and booleans are rendered verbatim and never defused, so values
  // like -1 are never mistaken for a formula.
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  let text = String(value);
  // Defuse spreadsheet formula injection for text fields.
  if (text.length > 0 && FORMULA_PREFIXES.has(text[0])) {
    text = "'" + text;
  }
  // RFC4180 quoting: wrap fields containing a comma, double quote, or line
  // break, doubling any embedded double quotes.
  if (needsQuotes(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function receiptsToCsv(
  receipts: ReadonlyArray<Partial<Receipt>>,
): string {
  const rows = [COLUMNS.join(",")];
  for (const receipt of receipts) {
    rows.push(COLUMNS.map((col) => toField(receipt?.[col])).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
