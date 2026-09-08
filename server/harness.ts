import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import TOML from "@iarna/toml";
import { RpcProcess } from "./rpc.ts";
import { CODEX_HOME, ROOT, STATE } from "./paths.ts";
import type { Pet } from "./types.ts";
import { localTransport } from "./local-transport.ts";

export function cleanEnvironment(billing: string, harness: "codex" | "claude" = "codex") {
  const env = { ...process.env };
  // These affect billing/routing independently of the selected sheet.
  for (const key of Object.keys(env))
    if (
      /^(OPENAI|CODEX_API|ANTHROPIC|CLAUDE_CODE_USE_|AWS_|GOOGLE_|AZURE_|MODEL_PROVIDER|CODEX_CONFIG|DEFAULT_AUTH_REQUEST|INITIAL_AGENT_MODE)/.test(
        key,
      )
    )
      delete env[key];
  if (billing === "api") {
    if (harness === "codex" && process.env.OPENAI_API_KEY)
      env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (harness === "claude" && process.env.ANTHROPIC_API_KEY)
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_PATH;
  return env;
}
export async function createHarness(pet: Pet, cwd: string, runId: string) {
  const env = cleanEnvironment(pet.petshop.billing, pet.petshop.harness);
  const home = path.join(STATE, "sessions", runId, pet.id);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const telemetry = path.join(home, "telemetry.jsonl");
  if (pet.petshop.harness === "codex") {
    if (pet.petshop.billing === "subscription") {
      const auth = JSON.parse(
        await fs
          .readFile(path.join(CODEX_HOME, "auth.json"), "utf8")
          .catch(() => '{"auth_mode":"missing"}'),
      );
      if (auth.auth_mode !== "chatgpt" || !auth.tokens)
        throw new Error(
          "Codex subscription login is unavailable. Run codex login with ChatGPT first. API fallback is disabled.",
        );
      delete auth.OPENAI_API_KEY;
      await fs.writeFile(path.join(home, "auth.json"), JSON.stringify(auth), {
        mode: 0o600,
      });
    } else if (pet.petshop.billing === "api") {
      if (!env.OPENAI_API_KEY)
        throw new Error("OPENAI_API_KEY is not configured.");
      await fs.writeFile(
        path.join(home, "auth.json"),
        JSON.stringify({
          auth_mode: "apikey",
          OPENAI_API_KEY: env.OPENAI_API_KEY,
        }),
        { mode: 0o600 },
      );
    }
    const provider =
      pet.petshop.billing === "local"
        ? pet.model_provider || "petshop_local"
        : "openai";
    const config: any = {
      model: pet.model,
      model_provider: provider,
      model_reasoning_effort: pet.model_reasoning_effort,
      sandbox_mode: pet.sandbox_mode,
      approval_policy: pet.approval_policy,
      developer_instructions: pet.developer_instructions,
      features: { multi_agent: false, memories: false },
      project_doc_max_bytes: 16000,
    };
    if (pet.model_context_window)
      config.model_context_window = pet.model_context_window;
    const transport =
      pet.petshop.billing === "local"
        ? await localTransport(
            pet.petshop.endpoint || "http://127.0.0.1:8080/v1",
          )
        : null;
    if (transport) {
      config.web_search = "disabled";
      config.model_providers = {
        [provider]: {
          name: pet.petshop.model_identity,
          base_url: transport.url,
          wire_api: "responses",
          requires_openai_auth: false,
          request_max_retries: 0,
          stream_max_retries: 0,
        },
      };
    }
    await fs.writeFile(path.join(home, "config.toml"), TOML.stringify(config), {
      mode: 0o600,
    });
    Object.assign(env, {
      CODEX_HOME: home,
      MODEL_PROVIDER: provider,
      CODEX_CONFIG: JSON.stringify(config),
      CODEX_PATH: path.join(ROOT, "server/codex-policy.mjs"),
      PETSHOP_LEASH: pet.sandbox_mode,
      PETSHOP_APPROVAL: pet.approval_policy,
      PETSHOP_MODEL: pet.model,
      PETSHOP_TELEMETRY: telemetry,
      INITIAL_AGENT_MODE:
        pet.sandbox_mode === "danger-full-access"
          ? "agent-full-access"
          : "read-only",
    });
    const rpc = new RpcProcess(
      process.execPath,
      [
        path.join(
          ROOT,
          "node_modules/@agentclientprotocol/codex-acp/dist/index.js",
        ),
      ],
      { cwd, env },
    );
    rpc.child.on("exit", () => transport?.close());
    return { rpc, home, telemetry, sessionMeta: {} };
  }
  if (pet.petshop.billing === "subscription") {
    const auth = JSON.parse(
      await fs
        .readFile(path.join(os.homedir(), ".claude/.credentials.json"), "utf8")
        .catch(() => "{}"),
    );
    if (!auth.claudeAiOauth?.accessToken)
      throw new Error(
        "Claude subscription login is unavailable. Run claude /login first. API fallback is disabled.",
      );
    await fs.writeFile(
      path.join(home, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: auth.claudeAiOauth }),
      { mode: 0o600 },
    );
  } else if (!env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  env.CLAUDE_CONFIG_DIR = home;
  const mode =
    pet.sandbox_mode === "danger-full-access"
      ? "bypassPermissions"
      : pet.sandbox_mode === "read-only"
        ? "plan"
        : "default";
  const sessionMeta = {
    systemPrompt: { append: pet.developer_instructions },
    claudeCode: {
      options: {
        model: pet.model,
        effort: pet.model_reasoning_effort,
        settingSources: [],
        settings: { permissions: { defaultMode: mode } },
        disallowedTools:
          pet.sandbox_mode === "read-only"
            ? ["Write", "Edit", "NotebookEdit", "Bash", "Agent", "Task"]
            : ["Agent", "Task"],
      },
    },
  };
  const rpc = new RpcProcess(
    process.execPath,
    [
      path.join(
        ROOT,
        "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
      ),
    ],
    { cwd, env },
  );
  return { rpc, home, telemetry, sessionMeta };
}
export async function readTelemetry(file: string) {
  const lines = (await fs.readFile(file, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean);
  const usage = new Map<string, any>();
  let limits: any = null;
  let realCost: number | null = null;
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (m.method === "thread/tokenUsage/updated")
        usage.set(m.params.threadId, m.params.tokenUsage.total);
      if (m.method === "account/rateLimits/updated")
        limits = m.params.rateLimits;
      const cost = m.params?.turn?.cost?.totalCostUsd;
      if (typeof cost === "number") realCost = (realCost || 0) + cost;
    } catch {}
  }
  const values = [...usage.values()];
  return {
    inputTokens: values.length
      ? values.reduce((n, u) => n + (u.inputTokens || 0), 0)
      : null,
    outputTokens: values.length
      ? values.reduce((n, u) => n + (u.outputTokens || 0), 0)
      : null,
    totalTokens: values.length
      ? values.reduce((n, u) => n + (u.totalTokens || 0), 0)
      : null,
    limits,
    realCost,
  };
}
