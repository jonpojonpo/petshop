import fs from "node:fs/promises";
import path from "node:path";
import { STATE } from "./paths.ts";
import type { Receipt, Event } from "./types.ts";
export const ledgerPath = path.join(STATE, "ledger.jsonl");
export async function receipts(): Promise<Receipt[]> {
  const text = await fs.readFile(ledgerPath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}
export async function record(receipt: Receipt) {
  await fs.appendFile(ledgerPath, JSON.stringify(receipt) + "\n", {
    mode: 0o600,
  });
}
export async function appendEvent(event: Event) {
  await fs.appendFile(
    path.join(STATE, "runs", `${event.runId}.jsonl`),
    JSON.stringify(event) + "\n",
    { mode: 0o600 },
  );
}
