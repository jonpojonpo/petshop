/** Editor-facing ACP proxy. HTTP transports the local conductor's existing runs.
 * No agent loop: all inference and tools remain in the selected upstream harness. */
import { createInterface } from "node:readline";
import crypto from "node:crypto";
const base = process.env.PETSHOP_URL || "http://127.0.0.1:4321";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("PETSHOP_URL must point to the local conductor.");
const sessions = new Map<
  string,
  {
    cwd: string;
    petId: string;
    config: any;
    runId?: string;
    busy: boolean;
    cancelled: boolean;
  }
>();
const requests = new Map<
  string,
  { sessionId: string; resolve: (v: any) => void }
>();
const send = (m: any) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const notify = (sessionId: string, update: any) =>
  send({ method: "session/update", params: { sessionId, update } });
async function http(route: string, data?: any) {
  const r = await fetch(base + route, {
    ...(data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}
function clientRequest(method: string, params: any) {
  const id = `petshop-${crypto.randomUUID()}`;
  return new Promise<any>((resolve) => {
    requests.set(id, { sessionId: params.sessionId, resolve });
    send({ id, method, params });
  });
}
let initialized = false;
async function handle(method: string, params: any) {
  if (method === "initialize") {
    initialized = true;
    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { embeddedContext: false, image: false },
        mcpCapabilities: { http: false, sse: false },
      },
      agentInfo: { name: "petshop", title: "Petshop", version: "0.1.0" },
      authMethods: [],
    };
  }
  if (!initialized) throw new Error("Initialize the ACP connection first.");
  if (method === "session/new") {
    const catalog = await http("/api/catalog");
    const sessionId = crypto.randomUUID();
    const config = params._meta?.petshop || {};
    const petId =
      config.petId ||
      process.env.PETSHOP_PET ||
      catalog.pets.find((p: any) => p.petshop.role === "conductor")?.id;
    if (!catalog.pets.some((p: any) => p.id === petId))
      throw new Error("Select an installed pet.");
    sessions.set(sessionId, {
      cwd: params.cwd,
      petId,
      config,
      busy: false,
      cancelled: false,
    });
    return {
      sessionId,
      modes: {
        currentModeId: petId,
        availableModes: catalog.pets.map((p: any) => ({
          id: p.id,
          name: p.name,
          description: `${p.model} · ${p.petshop.billing} · ${p.sandbox_mode}`,
        })),
      },
    };
  }
  const s = sessions.get(params.sessionId);
  if (!s) throw new Error("Unknown ACP session.");
  if (method === "session/set_mode") {
    const c = await http("/api/catalog");
    if (!c.pets.some((p: any) => p.id === params.modeId))
      throw new Error("Unknown pet.");
    if (s.busy)
      throw new Error("Finish the current quest before selecting another pet.");
    s.petId = params.modeId;
    return {};
  }
  if (method === "session/cancel") {
    s.cancelled = true;
    if (s.runId) await http(`/api/runs/${s.runId}/cancel`, {});
    for (const [id, r] of requests)
      if (r.sessionId === params.sessionId) {
        requests.delete(id);
        r.resolve({ outcome: { outcome: "cancelled" } });
      }
    return {};
  }
  if (method === "session/prompt") {
    if (s.busy) throw new Error("This session already has an active quest.");
    const text = (params.prompt || [])
      .filter((x: any) => x.type === "text")
      .map((x: any) => x.text)
      .join("\n");
    let q: any = { ...s.config };
    try {
      const parsed = JSON.parse(text.replace(/^\/quest\s+/, ""));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        q = { ...q, ...parsed };
    } catch {
      q.objective = text;
    }
    q.check ||= process.env.PETSHOP_CHECK;
    q.allowedPaths ||= process.env.PETSHOP_ALLOWED_PATHS?.split(",").map((p) =>
      p.trim(),
    );
    if (!q.check || !q.allowedPaths?.length) {
      notify(params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Petshop needs a checkable quest. Send JSON with objective, check, and allowedPaths (relative files, or folders ending in /). Alternatively set PETSHOP_CHECK and PETSHOP_ALLOWED_PATHS for ordinary prompts. Choose your pet using the session mode; the web shop shows each pet in its own tab.",
        },
      });
      return { stopReason: "end_turn" };
    }
    s.busy = true;
    s.cancelled = false;
    try {
      const run = await http("/api/runs", {
        ...q,
        petId: s.petId,
        repo: s.cwd,
        difficulty: q.difficulty || "routine",
        taskType: q.taskType || "implementation",
        requiredEquipment: q.requiredEquipment || [],
      });
      s.runId = run.id;
      notify(params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Quest ${run.id} · branch ${run.branch}\nWatch the party at ${base}/#run\n`,
        },
      });
      let seq = 0;
      const handled = new Set<string>();
      const deadline = Date.now() + 35 * 60_000;
      while (Date.now() < deadline) {
        const state = await http(`/api/runs/${run.id}`);
        for (const e of state.events.filter((e: any) => e.seq > seq)) {
          seq = e.seq;
          if (e.type === "acp")
            notify(params.sessionId, {
              ...e.data,
              _meta: {
                ...e.data._meta,
                petshop: { petId: e.petId, runId: run.id },
              },
            });
          else if (e.type === "decision" && !handled.has(e.data.id)) {
            handled.add(e.data.id);
            const r = await clientRequest("session/request_permission", {
              sessionId: params.sessionId,
              toolCall: e.data.request?.toolCall || {
                toolCallId: e.data.id,
                title: e.data.title,
                kind: "other",
                status: "pending",
                rawInput: {
                  model: e.data.model,
                  billing: e.data.billing,
                  evidence: e.data.evidence,
                },
              },
              options: e.data.options.map((o: any) => ({
                ...o,
                kind:
                  o.kind ||
                  (o.optionId === "consult" ? "allow_once" : "reject_once"),
              })),
            });
            if (s.cancelled) continue;
            const option =
              r?.outcome?.outcome === "selected"
                ? r.outcome.optionId
                : e.data.options.find(
                    (o: any) =>
                      o.kind?.startsWith("reject") || o.optionId === "stop",
                  )?.optionId;
            if (option) await http(`/api/decisions/${e.data.id}`, { option });
            else await http(`/api/runs/${run.id}/cancel`, {});
          } else if (
            ["check", "receipt", "commit", "error", "handoff"].includes(e.type)
          )
            notify(params.sessionId, {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `\n[${e.type}] ${JSON.stringify(e.data)}\n`,
              },
            });
        }
        if (state.finishedAt) {
          return {
            stopReason: state.status === "cancelled" ? "cancelled" : "end_turn",
          };
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      await http(`/api/runs/${run.id}/cancel`, {});
      throw new Error("Quest exceeded the proxy session timeout.");
    } catch (e) {
      if (s.runId)
        await http(`/api/runs/${s.runId}/cancel`, {}).catch(() => {});
      throw e;
    } finally {
      s.busy = false;
    }
  }
  throw new Error(`Unsupported ACP method: ${method}`);
}
createInterface({ input: process.stdin })
  .on("line", (line) => {
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Invalid JSON" } });
      return;
    }
    if (!m.method && requests.has(m.id)) {
      requests.get(m.id)!.resolve(m.result);
      requests.delete(m.id);
      return;
    }
    if (!m.method) return;
    void handle(m.method, m.params || {}).then(
      (result) => {
        if (m.id != null) send({ id: m.id, result });
      },
      (error) => {
        if (m.id != null)
          send({ id: m.id, error: { code: -32603, message: error.message } });
        else process.stderr.write(error.message + "\n");
      },
    );
  })
  .on("close", () => {
    for (const s of sessions.values())
      if (s.busy && s.runId)
        void http(`/api/runs/${s.runId}/cancel`, {}).catch(() => {});
    for (const r of requests.values())
      r.resolve({ outcome: { outcome: "cancelled" } });
  });
