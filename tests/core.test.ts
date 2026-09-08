import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  normalize,
  parseSheet,
  sheetToml,
  fingerprint,
} from "../server/sheets.ts";
import { allowedFile, git, commitBounded, runCheck } from "../server/git.ts";
import { cleanEnvironment, readTelemetry } from "../server/harness.ts";
import { communityUrl, unpackBody } from "../server/community.ts";
import { normalizeResponses } from "../server/local-transport.ts";
import { GpuScheduler } from "../server/gpu.ts";
import { parseClaudeUsage } from "../server/usage.ts";
import {
  validateEntry,
  validateRoster,
  eligible,
  rotate,
  bodyFor,
  redact,
  openrouterKey,
  roster,
  attribution,
} from "../server/openrouter.ts";
const fixture = () =>
  normalize({
    name: "Test",
    description: "A bounded test pet",
    model: "local-test",
    model_provider: "local",
    developer_instructions: 'Preserve "quotes" and\nnewlines.',
    petshop: {
      harness: "codex",
      billing: "local",
      model_identity: "test-weights",
      equipment: ["rg", "shell"],
      body: "juno",
      role: "scout",
      refusal: "unknown",
    },
    custom_future_field: { keep: true },
  });

test("Codex TOML round trip preserves native fields, instructions, and unknown extensions", () => {
  const original = fixture();
  const round = parseSheet(sheetToml(original));
  assert.deepEqual(round, original);
  assert.equal(round.sandbox_mode, "read-only");
});
test("local wire compatibility combines developer messages ahead of the conversation without dropping tool results", () => {
  const tool = { type: "function_call_output", call_id: "a", output: "done" };
  const result = normalizeResponses({
    instructions: "system",
    input: [
      { role: "user", content: "request" },
      { role: "developer", content: [{ type: "input_text", text: "rules" }] },
      tool,
    ],
  });
  assert.equal(result.instructions, "system\n\nrules");
  assert.deepEqual(result.input, [{ role: "user", content: "request" }, tool]);
});
test("billing and model routing reject remote endpoints labelled as free local inference", () => {
  assert.throws(
    () =>
      normalize({
        ...fixture(),
        petshop: { ...fixture().petshop, endpoint: "https://example.com/v1" },
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      normalize({
        ...fixture(),
        petshop: { ...fixture().petshop, harness: "claude" },
      }),
    /Codex harness/,
  );
});
test("XP fingerprint changes when weights or harness change, not when personality changes", () => {
  const a = fixture();
  assert.notEqual(
    fingerprint(a),
    fingerprint({
      ...a,
      petshop: { ...a.petshop, model_identity: "other-weights" },
    }),
  );
  assert.notEqual(
    fingerprint(a),
    fingerprint({ ...a, petshop: { ...a.petshop, harness: "claude" } }),
  );
  assert.equal(
    fingerprint(a),
    fingerprint({ ...a, developer_instructions: "Different personality" }),
  );
});
test("subscription and local environments cannot inherit metered API overrides", () => {
  const old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "https://example.com";
  try {
    for (const billing of ["local", "subscription"]) {
      const env = cleanEnvironment(billing);
      assert.equal(env.ANTHROPIC_API_KEY, undefined);
      assert.equal(env.OPENAI_BASE_URL, undefined);
    }
    assert.equal(cleanEnvironment("api", "claude").ANTHROPIC_API_KEY, "test-key");
    assert.equal(cleanEnvironment("api", "codex").ANTHROPIC_API_KEY, undefined);
    assert.equal(cleanEnvironment("api", "claude").OPENAI_API_KEY, undefined);
  } finally {
    if (old) process.env.ANTHROPIC_API_KEY = old;
    else delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  }
});
test("allowed scopes distinguish exact files, folders, traversal and Git metadata", () => {
  assert.equal(allowedFile("app/a.ts", ["app/"]), true);
  assert.equal(allowedFile("app/a.ts", ["app/a.ts"]), true);
  for (const name of [
    "app2/a.ts",
    "../app/a.ts",
    "/app/a.ts",
    ".git/config",
    "app/a.tsx",
  ])
    assert.equal(allowedFile(name, ["app/a.ts"]), false);
});
test("community redirects and malformed body packages fail closed", () => {
  assert.equal(
    communityUrl("/api/pets/cat/download").origin,
    "https://codex-pets.net",
  );
  for (const u of [
    "http://127.0.0.1/x",
    "https://evil.example/x",
    "https://user@codex-pets.net/x",
  ])
    assert.throws(() => communityUrl(u));
  const zip = zipSync({
    "pet.json": strToU8(
      JSON.stringify({
        id: "cat",
        spriteVersionNumber: 1,
        spritesheetPath: "spritesheet.webp",
        displayName: "Cat",
      }),
    ),
    "spritesheet.webp": new Uint8Array([1, 2, 3]),
  });
  assert.throws(() => unpackBody(zip, "cat"), /manifest/);
  assert.throws(
    () => unpackBody(zipSync({ "../../pet.json": strToU8("{}") }), "cat"),
    /root/,
  );
});
test("cumulative Codex telemetry counts each thread once instead of adding cumulative updates", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "petshop-usage-"));
  try {
    const file = path.join(dir, "events");
    const event = (n: number) => ({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "a",
        tokenUsage: {
          total: { inputTokens: n, outputTokens: n, totalTokens: n * 2 },
        },
      },
    });
    await fs.writeFile(
      file,
      [event(10), event(20)].map((e) => JSON.stringify(e)).join("\n"),
    );
    assert.equal((await readTelemetry(file)).totalTokens, 40);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("bounded commits refuse out-of-scope writes and preserve Git history", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "petshop-git-"));
  try {
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "test@example.invalid");
    await git(dir, "config", "user.name", "Petshop test");
    await fs.writeFile(path.join(dir, "a.txt"), "before");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    const base = await git(dir, "rev-parse", "HEAD");
    await fs.writeFile(path.join(dir, "outside.txt"), "unapproved");
    await assert.rejects(
      commitBounded(dir, base, ["a.txt"], "Test"),
      /boundary/,
    );
    assert.equal(await git(dir, "rev-parse", "HEAD"), base);
    await fs.rm(path.join(dir, "outside.txt"));
    await fs.writeFile(path.join(dir, "a.txt"), "after");
    assert.ok(await commitBounded(dir, base, ["a.txt"], "Test"));
    assert.equal(await git(dir, "status", "--porcelain"), "");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("completion checks reflect actual process failure and cancellation", async () => {
  const c = new AbortController();
  assert.equal((await runCheck(process.cwd(), "exit 7", c.signal)).ok, false);
  const check = runCheck(process.cwd(), "sleep 10", c.signal);
  setTimeout(() => c.abort(), 50);
  assert.equal((await check).ok, false);
});

test("cancelling a queued GPU pet preserves FIFO exclusion and releases its queue slot", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "petshop-gpu-"));
  class ReadyGpu extends GpuScheduler {
    async ensureModel() {}
  }
  const gpu = new ReadyGpu(path.join(dir, "gpu.lock"));
  const first = new AbortController();
  const second = new AbortController();
  const third = new AbortController();
  try {
    const release = await gpu.acquire(
      "first",
      fixture() as any,
      first.signal,
      () => {},
    );
    const queued = gpu.acquire(
      "second",
      fixture() as any,
      second.signal,
      () => {},
    );
    const rejection = assert.rejects(queued, /Cancelled while queued/);
    const last = gpu.acquire("third", fixture() as any, third.signal, () => {});
    second.abort();
    await rejection;
    assert.equal(gpu.owner, "first");
    assert.deepEqual(gpu.waiting, ["third"]);
    await release();
    const releaseLast = await last;
    assert.equal(gpu.owner, "third");
    await releaseLast();
    assert.equal(gpu.owner, null);
    await assert.rejects(fs.access(path.join(dir, "gpu.lock")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const rosterEntry = (over: any = {}) => ({
  id: "vendor/model-a:free",
  name: "Model A",
  contextLength: 65536,
  capabilities: {
    chat: true,
    tools: true,
    structuredOutputs: false,
    reasoning: false,
  },
  pricing: { prompt: "0", completion: "0" },
  ...over,
});

test("roster validation rejects entries missing ids, capabilities or free pricing", () => {
  assert.ok(validateEntry(rosterEntry()));
  assert.throws(() => validateEntry(rosterEntry({ id: "vendor/paid" })), /free/);
  assert.throws(() => validateEntry(rosterEntry({ name: "  " })), /display name/);
  assert.throws(() => validateEntry(rosterEntry({ contextLength: 12 })), /context/);
  assert.throws(
    () =>
      validateEntry(
        rosterEntry({ capabilities: { chat: true, tools: true, reasoning: false } }),
      ),
    /structuredOutputs/,
  );
  // A model that starts charging must not keep a free badge.
  assert.throws(
    () => validateEntry(rosterEntry({ pricing: { prompt: "0.0000012", completion: "0" } })),
    /not a free model/,
  );
  assert.throws(() => validateRoster({ version: 1, capturedAt: "x", models: [] }), /at least one/);
  assert.throws(
    () =>
      validateRoster({
        version: 1,
        capturedAt: "x",
        models: [rosterEntry(), rosterEntry()],
      }),
    /repeats/,
  );
});

test("rotation only offers tool-capable models to coding quests and is reproducible", () => {
  const models = [
    rosterEntry({ id: "vendor/chat-only:free" , capabilities:{chat:true,tools:false,structuredOutputs:false,reasoning:false}}),
    rosterEntry({ id: "vendor/coder:free" }),
  ];
  assert.deepEqual(
    eligible("coding", models).map((m) => m.id),
    ["vendor/coder:free"],
  );
  assert.equal(eligible("chat", models).length, 2);
  // The shipped roster must never offer a coding pet that cannot call tools.
  assert.ok(eligible("coding").every((m) => m.capabilities.tools));
  const bodies = ["juno", "chika", "rocky"];
  const first = rotate("coding", bodies, [], () => 0);
  assert.ok(first.modelId.endsWith(":free"));
  assert.equal(first.billing, "free-api");
  assert.equal(first.provider, "openrouter");
  assert.equal(first.remote, true);
  assert.match(first.notice, /leave this machine/);
  // A stable body per model: a pet you liked is recognisable next time.
  assert.equal(first.body, bodyFor(first.modelId, bodies));
  assert.equal(bodyFor(first.modelId, bodies), bodyFor(first.modelId, bodies));
  // Rotation avoids what you have already seen, and never returns nothing.
  const seen = roster().models.filter((m) => m.capabilities.tools).map((m) => m.id);
  assert.ok(rotate("coding", bodies, seen, () => 0).modelId);
});

test("a receipt records the backend that actually served the request", () => {
  // The name is stable but the backend behind it is not, so both are kept.
  const served = attribution(
    {
      model: "nvidia/nemotron-3.5-lightning:free",
      provider: "Nvidia",
      usage: { prompt_tokens: 17, completion_tokens: 133, total_tokens: 150, cost: 0 },
    },
    "nvidia/nemotron-3.5-lightning:free",
  );
  assert.equal(served.servedProvider, "Nvidia");
  assert.equal(served.requestedModel, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(served.costUsd, 0);
  assert.equal(served.totalTokens, 150);
  // Missing attribution stays unknown rather than being invented.
  const blank = attribution({}, "vendor/model-a:free");
  assert.equal(blank.servedProvider, null);
  assert.equal(blank.costUsd, null);
  assert.equal(blank.totalTokens, null);
  assert.equal(blank.requestedModel, "vendor/model-a:free");
});

test("the OpenRouter credential cannot reach a log, a harness child, or a sheet", () => {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-topsecretvalue";
  try {
    assert.equal(openrouterKey(), "sk-or-v1-topsecretvalue");
    assert.equal(
      redact("failed calling with sk-or-v1-topsecretvalue in the message"),
      "failed calling with [redacted] in the message",
    );
    // Even an unrelated key shape is scrubbed.
    assert.match(redact("sk-or-v1-someotherkey"), /\[redacted\]/);
    for (const billing of ["free-api", "api", "local", "subscription"])
      assert.equal(cleanEnvironment(billing).OPENROUTER_API_KEY, undefined);
    delete process.env.OPENROUTER_API_KEY;
    assert.throws(() => openrouterKey(), /OPENROUTER_API_KEY is not set/);
  } finally {
    if (old) process.env.OPENROUTER_API_KEY = old;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("a free remote pet cannot be mistaken for a local or subscription pet", () => {
  const free = normalize({
    name: "Visitor",
    description: "A free remote visitor",
    model: "vendor/model-a:free",
    model_provider: "openrouter",
    petshop: {
      harness: "codex",
      billing: "free-api",
      provider: "openrouter",
      model_identity: "vendor/model-a:free",
      body: "chika",
      equipment: ["rg"],
      role: "scout",
      refusal: "unknown",
    },
  });
  assert.equal(free.petshop.billing, "free-api");
  assert.equal(free.petshop.provider, "openrouter");
  // A remote catalogue must never fall through to the free/private local default.
  assert.notEqual(free.petshop.billing, "local");
  const bad = (over: any) =>
    normalize({ ...free, ...over, petshop: { ...free.petshop, ...(over.petshop || {}) } });
  assert.throws(() => bad({ petshop: { provider: undefined } }), /Free-API billing requires/);
  assert.throws(() => bad({ petshop: { harness: "claude" } }), /Codex harness/);
  assert.throws(() => bad({ petshop: { provider: "together" } }), /only supported remote/);
  // The ':free' badge and the model id cannot disagree in either direction.
  assert.throws(() => bad({ model: "vendor/model-a" }), /':free' model id/);
  assert.throws(
    () => bad({ petshop: { billing: "api" } }),
    /paid OpenRouter profile needs a paid model id/,
  );
  assert.throws(() => normalize({ ...free, petshop: { ...free.petshop, billing: "gratis" } }), /billing/);
});

test("swapping a free pet to a paid profile keeps its identity but not its free XP", () => {
  const base = {
    name: "Visitor",
    description: "A free remote visitor",
    model: "vendor/model-a:free",
    model_provider: "openrouter",
    petshop: {
      harness: "codex" as const,
      billing: "free-api",
      provider: "openrouter" as const,
      model_identity: "vendor/model-a:free",
      body: "chika",
      equipment: ["rg"],
      role: "scout" as const,
      refusal: "unknown" as const,
    },
  };
  const free = normalize(base);
  const paid = normalize({
    ...base,
    model: "vendor/model-a",
    petshop: { ...base.petshop, billing: "api", model_identity: "vendor/model-a" },
  });
  assert.equal(free.name, paid.name);
  assert.equal(free.petshop.body, paid.petshop.body);
  // Different weights behind the same name: XP must not carry across the swap.
  assert.notEqual(fingerprint(free), fingerprint(paid));
});

test("Claude usage reports separate windows and retains unknown reset labels", () => {
  const windows = parseClaudeUsage(
    "**Current session (5h)** — **6%** · Resets Sep 8, 3:00 PM UTC\n**Current week** — **17%**",
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0].usedPercent, 6);
  assert.equal(windows[1].usedPercent, 17);
  assert.equal(windows[1].resetsAt, null);
  assert.ok(windows[0].resetsAt?.endsWith('T15:00:00.000Z'));
  assert.equal(windows[1].resetsLabel, undefined);
});
