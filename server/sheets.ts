import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import TOML from "@iarna/toml";
import { ROOT, AGENTS, assertId, expand } from "./paths.ts";
import { receipts } from "./ledger.ts";
import type { Pet, Sheet, ShopFields } from "./types.ts";
const dependencies = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
).dependencies;

export function normalize(input: any): Sheet {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("A pet sheet must be a TOML object.");
  for (const key of ["name", "description", "model"])
    if (typeof input[key] !== "string" || !input[key].trim())
      throw new Error(`${key} is required.`);
  // A remote catalogue must never fall through to the local default below.
  const local =
    !!input.model_provider &&
    !["openai", "anthropic", "openrouter"].includes(input.model_provider);
  const shop: ShopFields = {
    harness: "codex",
    billing: local ? "local" : "subscription",
    body: local ? "juno" : "chika",
    equipment: ["rg", "git", "shell"],
    role: "scout",
    refusal: "unknown",
    model_identity: input.model,
    ...input.petshop,
  };
  if (!["codex", "claude"].includes(shop.harness))
    throw new Error("Supported harnesses are Codex and Claude.");
  if (!["local", "subscription", "api", "free-api"].includes(shop.billing))
    throw new Error("Choose local, subscription, free-API, or API billing.");
  if (shop.billing === "local" && shop.harness !== "codex")
    throw new Error("Local inference currently uses the Codex harness.");
  if (shop.provider != null && shop.provider !== "openrouter")
    throw new Error("The only supported remote catalogue is OpenRouter.");
  if (shop.billing === "free-api" && shop.provider !== "openrouter")
    throw new Error("Free-API billing requires the OpenRouter provider.");
  if (shop.provider === "openrouter") {
    if (shop.harness !== "codex")
      throw new Error("OpenRouter pets currently use the Codex harness.");
    if (!["free-api", "api"].includes(shop.billing))
      throw new Error("An OpenRouter pet is billed as free-API or API.");
    // A free pet must carry a free model id, so the badge can never lie.
    if (shop.billing === "free-api" && !input.model.endsWith(":free"))
      throw new Error("A free OpenRouter pet needs a ':free' model id.");
    if (shop.billing === "api" && input.model.endsWith(":free"))
      throw new Error("A paid OpenRouter profile needs a paid model id.");
  }
  if (!["conductor", "scout", "advisor", "worker"].includes(shop.role))
    throw new Error("Invalid role.");
  if (!["standard", "unguardrailed", "unknown"].includes(shop.refusal))
    throw new Error("Invalid refusal posture.");
  if (
    !Array.isArray(shop.equipment) ||
    shop.equipment.some((x) => typeof x !== "string" || x.length > 100)
  )
    throw new Error("Equipment must be a list of tool names.");
  if (typeof shop.body !== "string" || typeof shop.model_identity !== "string")
    throw new Error("Body and model identity must be strings.");
  if (shop.launch_command && typeof shop.launch_command !== "string")
    throw new Error("Invalid launcher.");
  if (
    shop.launch_args &&
    (!Array.isArray(shop.launch_args) ||
      shop.launch_args.some((x) => typeof x !== "string"))
  )
    throw new Error("Launcher arguments must be strings.");
  if (shop.endpoint) {
    const url = new URL(shop.endpoint);
    if (
      shop.billing === "local" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("Local billing requires a loopback model endpoint.");
  }
  const leash = input.sandbox_mode || "read-only";
  if (!["read-only", "workspace-write", "danger-full-access"].includes(leash))
    throw new Error("Invalid access level.");
  const approval = input.approval_policy || "on-request";
  if (!["on-request", "never"].includes(approval))
    throw new Error("Invalid approval policy.");
  if (
    input.model_context_window != null &&
    (!Number.isInteger(input.model_context_window) ||
      input.model_context_window < 1024)
  )
    throw new Error("Context must be at least 1024 tokens.");
  if (
    input.developer_instructions != null &&
    typeof input.developer_instructions !== "string"
  )
    throw new Error("Temperament must be text.");
  return {
    ...input,
    sandbox_mode: leash,
    approval_policy: approval,
    model_reasoning_effort: input.model_reasoning_effort || "low",
    developer_instructions: input.developer_instructions || "",
    petshop: shop,
  };
}
export function fingerprint(sheet: Sheet) {
  const bridge =
    sheet.petshop.harness === "codex"
      ? "@agentclientprotocol/codex-acp"
      : "@agentclientprotocol/claude-agent-acp";
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        sheet.model,
        sheet.model_provider,
        sheet.petshop.harness,
        dependencies[bridge],
        sheet.petshop.model_identity,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}
export function parseSheet(text: string) {
  return normalize(TOML.parse(text));
}
export function sheetToml(sheet: Sheet) {
  const { id, source, fingerprint, xp, tokens, observedTps, ...data } =
    sheet as any;
  return TOML.stringify(normalize(data) as any);
}
export async function listPets(): Promise<{ pets: Pet[]; errors: string[] }> {
  const files = await fs.readdir(AGENTS);
  const rows = await receipts();
  const errors: string[] = [];
  const pets = (
    await Promise.all(
      files
        .filter((f) => f.endsWith(".toml"))
        .map(async (file) => {
          try {
            const sheet = parseSheet(
              await fs.readFile(path.join(AGENTS, file), "utf8"),
            );
            const fp = fingerprint(sheet);
            const mine = rows.filter(
              (r) => r.fingerprint === fp && r.petId === file.slice(0, -5),
            );
            const tokens = mine.reduce((n, r) => n + (r.totalTokens || 0), 0);
            const measured = mine.filter(
              (r) => r.outputTokens != null && r.elapsedSeconds > 0,
            );
            return {
              ...sheet,
              id: file.slice(0, -5),
              source: path.join(AGENTS, file),
              fingerprint: fp,
              xp: mine.reduce((n, r) => n + r.xp, 0),
              tokens,
              observedTps: measured.length
                ? measured.reduce((n, r) => n + (r.outputTokens || 0), 0) /
                  measured.reduce((n, r) => n + r.elapsedSeconds, 0)
                : null,
            };
          } catch (e) {
            errors.push(`${file}: ${(e as Error).message}`);
            return null;
          }
        }),
    )
  ).filter((p): p is Pet => !!p);
  return { pets, errors };
}
export async function getPet(id: string) {
  assertId(id);
  const pet = (await listPets()).pets.find((p) => p.id === id);
  if (!pet) throw new Error(`Pet ${id} was not found.`);
  return pet;
}
export async function saveSheet(id: string, input: any, overwrite = false) {
  assertId(id);
  const text =
    typeof input === "string"
      ? sheetToml(parseSheet(input))
      : sheetToml(normalize(input));
  const file = path.join(AGENTS, `${id}.toml`);
  if (overwrite) {
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  } else await fs.writeFile(file, text, { flag: "wx", mode: 0o600 });
  return getPet(id);
}
export async function seedConductor() {
  const file = path.join(AGENTS, "petshop-juno.toml");
  try {
    await fs.access(file);
    return;
  } catch {}
  await saveSheet("petshop-juno", {
    name: "Juno",
    description:
      "Local conductor. Curious, practical, and happiest with a small, testable quest.",
    model: "speed-qwen-27b",
    model_provider: "speed_qwen",
    model_reasoning_effort: "low",
    model_context_window: 98304,
    sandbox_mode: "workspace-write",
    approval_policy: "on-request",
    developer_instructions:
      "You are Juno, a local coding companion. Complete only the bounded quest. Read the relevant code, make a focused change, and verify it. Give brief progress updates. When stuck, write a concise account of the failed attempts and what help you need to the supplied loot directory. Do not alter quest checks, manage git branches, commit, or launch other agents: Petshop owns those operations.",
    petshop: {
      harness: "codex",
      billing: "local",
      body: "juno",
      equipment: ["rg", "git", "shell", "node", "python3"],
      role: "conductor",
      refusal: "unguardrailed",
      model_identity:
        "HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS + FastMTP-32K",
      endpoint: "http://127.0.0.1:8080/v1",
      launch_command: expand("~/speed-qwen/run-server.sh"),
      launch_args: [],
    },
  });
}
