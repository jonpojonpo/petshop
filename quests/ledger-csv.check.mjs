import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
const { receiptsToCsv } = await import(
  pathToFileURL(path.join(process.cwd(), "server/csv.ts")).href
);
const sample = {
  runId: "run-1",
  petId: "juno",
  model: "local",
  billing: "local",
  status: "completed",
  inputTokens: 10,
  outputTokens: 4,
  totalTokens: 14,
  marginalCostUsd: 0,
};
const header =
  "runId,petId,model,billing,status,inputTokens,outputTokens,totalTokens,marginalCostUsd\r\n";
assert.equal(receiptsToCsv([]), header);
assert.equal(
  receiptsToCsv([sample]),
  header + "run-1,juno,local,local,completed,10,4,14,0\r\n",
);
assert.equal(
  receiptsToCsv([
    {
      ...sample,
      petId: 'Pip, "the scout"',
      model: "line\nbreak",
      totalTokens: null,
      marginalCostUsd: null,
    },
  ]),
  header +
    'run-1,"Pip, ""the scout""","line\nbreak",local,completed,10,4,,\r\n',
);
assert.equal(
  receiptsToCsv([{ ...sample, petId: '=IMPORTXML("url")' }])
    .split("\r\n")[1]
    .includes('"\'=IMPORTXML(""url"")"'),
  true,
);
assert.equal(
  receiptsToCsv([{ ...sample, petId: "+SUM(1,2)" }]).includes('"\'+SUM(1,2)"'),
  true,
);
assert.equal(
  receiptsToCsv([{ ...sample, petId: "@cmd" }]).includes("'@cmd"),
  true,
);
assert.equal(
  receiptsToCsv([{ ...sample, petId: "-cmd" }]).includes("'-cmd"),
  true,
);
assert.equal(
  receiptsToCsv([{ ...sample, inputTokens: -1 }]).includes(",-1,"),
  true,
);
console.log(
  "Ledger CSV contract passed: empty ledger, columns, quoting, newlines, unknown costs, formula escaping.",
);
