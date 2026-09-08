import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./paths.ts";
import type { RosterEntry, Roster, Visitor } from "./types.ts";

export const ORIGIN = "https://openrouter.ai";
export const API = `${ORIGIN}/api/v1`;
const ROSTER_FILE = path.join(ROOT, "server/openrouter-roster.json");
/** Free models are logged by their providers and may be trained on. Say so everywhere. */
export const FREE_DATA_NOTICE =
  "Free OpenRouter models are remote. Prompts, code and output leave this machine, are logged by the provider, and may be used for training. Do not send private work.";

/** The key is read from the environment on every use and never persisted, so it
 * cannot reach a sheet, a receipt, a body package or Git. */
export function openrouterKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key)
    throw new Error(
      "OPENROUTER_API_KEY is not set in Petshop's environment. Export it and restart the shop.",
    );
  return key;
}
export const hasKey = () => !!process.env.OPENROUTER_API_KEY?.trim();

/** No caller should ever be able to echo the credential into a log or an event. */
export function redact(text: string) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  let out = text;
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/sk-or-v1-[A-Za-z0-9._-]+/g, "[redacted]");
}

export function validateEntry(entry: any, index = 0): RosterEntry {
  const where = `Roster entry ${index}`;
  if (!entry || typeof entry !== "object")
    throw new Error(`${where} is not an object.`);
  if (typeof entry.id !== "string" || !/^[\w.\/-]+:free$/.test(entry.id))
    throw new Error(`${where} needs a free OpenRouter model id.`);
  if (typeof entry.name !== "string" || !entry.name.trim())
    throw new Error(`${where} needs a display name.`);
  if (!Number.isInteger(entry.contextLength) || entry.contextLength < 1024)
    throw new Error(`${where} needs a context length of at least 1024.`);
  const caps = entry.capabilities;
  if (!caps || typeof caps !== "object")
    throw new Error(`${where} needs a capabilities block.`);
  for (const flag of ["chat", "tools", "structuredOutputs", "reasoning"])
    if (typeof caps[flag] !== "boolean")
      throw new Error(`${where} is missing the ${flag} capability flag.`);
  const pricing = entry.pricing;
  if (!pricing || typeof pricing !== "object")
    throw new Error(`${where} needs pricing metadata.`);
  for (const field of ["prompt", "completion"]) {
    const value = Number(pricing[field]);
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${where} has invalid ${field} pricing.`);
    if (value !== 0)
      throw new Error(`${where} is priced above zero and is not a free model.`);
  }
  return entry as RosterEntry;
}

export function validateRoster(input: any): Roster {
  if (!input || typeof input !== "object")
    throw new Error("Roster must be an object.");
  if (!Number.isInteger(input.version) || input.version < 1)
    throw new Error("Roster needs a positive integer version.");
  if (typeof input.capturedAt !== "string" || !input.capturedAt.trim())
    throw new Error("Roster needs a capture date.");
  if (!Array.isArray(input.models) || !input.models.length)
    throw new Error("Roster needs at least one model.");
  const models = input.models.map(validateEntry);
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.id)) throw new Error(`Roster repeats ${m.id}.`);
    seen.add(m.id);
  }
  return { ...input, models } as Roster;
}

let cached: Roster | null = null;
export function roster(): Roster {
  if (!cached)
    cached = validateRoster(JSON.parse(readFileSync(ROSTER_FILE, "utf8")));
  return cached;
}
/** Tests and the refresh route replace the roster without touching the file. */
export function setRoster(next: any) {
  cached = validateRoster(next);
  return cached;
}

export type Purpose = "chat" | "coding";
/** A coding pet drives a real harness, so it must be able to call tools. */
export function eligible(purpose: Purpose, from = roster().models) {
  return from.filter((m) =>
    purpose === "coding" ? m.capabilities.tools : m.capabilities.chat,
  );
}

/** Stable per model: the same model always wears the same body, so a pet you
 * liked yesterday is recognisable today. */
export function bodyFor(modelId: string, bodies: string[]) {
  if (!bodies.length) return "chika";
  const digest = crypto.createHash("sha256").update(modelId).digest();
  return bodies[digest.readUInt32BE(0) % bodies.length];
}

export function rotate(
  purpose: Purpose,
  bodies: string[],
  exclude: string[] = [],
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): Visitor {
  const all = eligible(purpose);
  if (!all.length)
    throw new Error(`No free OpenRouter model supports ${purpose} work.`);
  const pool = all.filter((m) => !exclude.includes(m.id));
  const from = pool.length ? pool : all;
  const model = from[Math.min(Math.max(pick(from.length), 0), from.length - 1)];
  return {
    modelId: model.id,
    name: model.name,
    contextLength: model.contextLength,
    capabilities: model.capabilities,
    pricing: model.pricing,
    body: bodyFor(model.id, bodies),
    provider: "openrouter",
    billing: "free-api",
    remote: true,
    notice: FREE_DATA_NOTICE,
  };
}

function describe(status: number, body: string) {
  if (status === 401 || status === 403)
    return "OpenRouter rejected the credential. Check OPENROUTER_API_KEY.";
  if (status === 402)
    return "This OpenRouter model needs credit on your account.";
  if (status === 404) return "OpenRouter no longer serves this model. Rotate to another free pet.";
  if (status === 429)
    return "OpenRouter is rate limiting this free model. Wait, or rotate to another free pet.";
  if (status >= 500)
    return `OpenRouter is unavailable right now (HTTP ${status}).`;
  return `OpenRouter returned HTTP ${status}. ${redact(body.slice(0, 200))}`;
}

async function call(pathname: string, init: RequestInit, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetch(`${API}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${openrouterKey()}`,
        "HTTP-Referer": "https://github.com/jonpojonpo/petshop",
        "X-Title": "Petshop",
      },
    });
  } catch (e) {
    const error = e as Error;
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw new Error("OpenRouter did not respond in time.");
    throw new Error(`OpenRouter is unreachable: ${redact(error.message)}`);
  }
  if (!response.ok)
    throw new Error(describe(response.status, await response.text().catch(() => "")));
  return response;
}

/** One request, one reply. Petshop never iterates tool calls itself: a chat
 * trial is a single turn, and real work goes through a harness. */
export async function chatOnce(
  modelId: string,
  messages: { role: string; content: string }[],
  timeoutMs = 60_000,
) {
  const entry = roster().models.find((m) => m.id === modelId);
  if (!entry) throw new Error(`${modelId} is not on the free roster.`);
  const response = await call(
    "/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, messages, stream: false }),
    },
    timeoutMs,
  );
  const data: any = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.choices) || !data.choices.length)
    throw new Error("OpenRouter returned no completion.");
  return {
    text: String(data.choices[0]?.message?.content ?? ""),
    generationId: typeof data.id === "string" ? data.id : null,
    ...attribution(data, modelId),
  };
}

/** OpenRouter names the backend it actually used on every response. Free-tier
 * generations are absent from /generation, so this inline field is the only
 * reliable attribution — and XP must never accrue against an unknown backend. */
export function attribution(data: any, requested?: string) {
  const cost = Number(data?.usage?.cost);
  return {
    requestedModel: requested ?? (typeof data?.model === "string" ? data.model : null),
    servedModel: typeof data?.model === "string" ? data.model : null,
    servedProvider: typeof data?.provider === "string" ? data.provider : null,
    costUsd: Number.isFinite(cost) ? cost : null,
    inputTokens: Number(data?.usage?.prompt_tokens) || null,
    outputTokens: Number(data?.usage?.completion_tokens) || null,
    totalTokens: Number(data?.usage?.total_tokens) || null,
  };
}

/** Paid profiles only: free-tier generations are not recorded here (the endpoint
 * 404s for them), so treat a null return as "cost unknown" and fall back to the
 * inline attribution above. */
export async function generationMeta(generationId: string, timeoutMs = 15_000) {
  try {
    const response = await call(
      `/generation?id=${encodeURIComponent(generationId)}`,
      { method: "GET" },
      timeoutMs,
    );
    const data: any = await response.json().catch(() => null);
    const row = data?.data ?? data;
    if (!row || typeof row !== "object") return null;
    return {
      provider: typeof row.provider_name === "string" ? row.provider_name : null,
      servedModel: typeof row.model === "string" ? row.model : null,
      costUsd: Number.isFinite(Number(row.total_cost)) ? Number(row.total_cost) : null,
      inputTokens: Number.isFinite(Number(row.tokens_prompt)) ? Number(row.tokens_prompt) : null,
      outputTokens: Number.isFinite(Number(row.tokens_completion)) ? Number(row.tokens_completion) : null,
    };
  } catch {
    // Telemetry is best-effort; a missing provider stays unknown in the ledger.
    return null;
  }
}

/** The paid twin of a free model, with live pricing. Costs are quoted from the
 * catalogue at swap time rather than from the snapshot, because a stale price
 * shown next to a "launch" button is worse than no price at all. */
export async function paidProfile(freeModelId: string, timeoutMs = 25_000) {
  const target = freeModelId.replace(/:free$/, "");
  const response = await call("/models", { method: "GET" }, timeoutMs);
  const data: any = await response.json().catch(() => null);
  const found = (data?.data || []).find((m: any) => m?.id === target);
  if (!found)
    throw new Error(
      `OpenRouter has no paid profile for ${freeModelId}. This model is free-tier only.`,
    );
  const pricing = found.pricing || {};
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion))
    throw new Error(`OpenRouter did not quote a usable price for ${target}.`);
  const supported = new Set<string>(found.supported_parameters || []);
  return {
    modelId: target,
    name: found.name || target,
    contextLength: found.context_length || 0,
    capabilities: {
      chat: true,
      tools: supported.has("tools"),
      structuredOutputs: supported.has("structured_outputs"),
      reasoning: supported.has("reasoning"),
    },
    pricing: { prompt: String(pricing.prompt), completion: String(pricing.completion) },
    // Quoted per million tokens, which is how everyone else quotes it.
    perMillion: {
      prompt: prompt * 1_000_000,
      completion: completion * 1_000_000,
    },
  };
}

/** Refresh re-reads the live catalogue and validates it before it replaces the
 * snapshot, so a bad upstream response cannot empty the kennel. */
export async function refreshRoster(timeoutMs = 25_000) {
  const response = await call("/models", { method: "GET" }, timeoutMs);
  const data: any = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.data))
    throw new Error("OpenRouter returned an unexpected catalogue format.");
  const models = data.data
    .filter((m: any) => typeof m?.id === "string" && m.id.endsWith(":free"))
    .map((m: any) => {
      const supported = new Set<string>(m.supported_parameters || []);
      const pricing = m.pricing || {};
      return {
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length || 0,
        maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null,
        capabilities: {
          chat: true,
          tools: supported.has("tools"),
          structuredOutputs: supported.has("structured_outputs"),
          reasoning: supported.has("reasoning"),
        },
        pricing: {
          prompt: String(pricing.prompt ?? "0"),
          completion: String(pricing.completion ?? "0"),
        },
      };
    })
    .filter((m: any) => {
      try {
        validateEntry(m);
        return true;
      } catch {
        return false;
      }
    });
  return setRoster({
    version: roster().version + 1,
    capturedAt: new Date().toISOString().slice(0, 10),
    source: `${API}/models`,
    note: roster().note,
    models,
  });
}
