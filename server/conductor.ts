import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { atomicJson, STATE, expand } from "./paths.ts";
import { getPet, listPets } from "./sheets.ts";
import { routeLocal } from "./routing.ts";
import { appendEvent, record, receipts } from "./ledger.ts";
import { createWorktree, runCheck, commitBounded } from "./git.ts";
import { createHarness, readTelemetry } from "./harness.ts";
import { GpuScheduler } from "./gpu.ts";
import type { RpcProcess } from "./rpc.ts";
import type { Event, Pet, Quest, Run, Receipt } from "./types.ts";

export class Conductor extends EventEmitter {
  runs = new Map<string, Run>();
  gpu = new GpuScheduler();
  private controllers = new Map<string, AbortController>();
  private active = new Map<string, { rpc: RpcProcess; sessionId: string }[]>();
  private decisions = new Map<
    string,
    { runId: string; options: string[]; resolve: (id: string) => void }
  >();
  private writing: Promise<void> = Promise.resolve();
  private petBusy = new Set<string>();
  private tasks = new Map<string, Promise<void>>();
  async init() {
    const rows = await receipts();
    for (const name of await fs.readdir(path.join(STATE, "runs"))) {
      if (!name.endsWith(".json")) continue;
      try {
        const run: Run = JSON.parse(
          await fs.readFile(path.join(STATE, "runs", name), "utf8"),
        );
        const events = (
          await fs
            .readFile(path.join(STATE, "runs", `${run.id}.jsonl`), "utf8")
            .catch(() => "")
        )
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        run.events = events;
        if (
          !["completed", "failed", "cancelled", "interrupted"].includes(
            run.status,
          )
        ) {
          run.status = "interrupted";
          run.error = "Petshop stopped before this quest finished.";
          for (const petId of run.pets) {
            if (rows.some((r) => r.runId === run.id && r.petId === petId))
              continue;
            const pet = await getPet(petId).catch(() => null);
            if (pet)
              await record({
                runId: run.id,
                petId,
                fingerprint: pet.fingerprint,
                taskType: run.quest.taskType,
                billing: pet.petshop.billing,
                model: pet.model,
                harness: pet.petshop.harness,
                status: "interrupted",
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                marginalCostUsd: pet.petshop.billing === "api" ? null : 0,
                providerCostUsd: null,
                elapsedSeconds: 0,
                checkPassed: false,
                xp: 0,
              });
          }
        }
        run.finishedAt ||= new Date().toISOString();
        this.runs.set(run.id, run);
        await this.persist(run);
      } catch {
        /* One damaged run must not hide the others. */
      }
    }
  }
  list() {
    return [...this.runs.values()].reverse().map(({ events, ...r }) => r);
  }
  async emitRun(run: Run, type: string, data: any, petId?: string) {
    const event: Event = {
      seq: run.events.length + 1,
      ts: new Date().toISOString(),
      runId: run.id,
      petId,
      type,
      data,
    };
    run.events.push(event);
    this.writing = this.writing.then(() => appendEvent(event));
    await this.writing;
    this.emit("event", event);
  }
  async persist(run: Run) {
    const { events, ...summary } = run;
    await atomicJson(path.join(STATE, "runs", `${run.id}.json`), summary);
  }
  async state(run: Run, status: string) {
    run.status = status;
    await this.persist(run);
    await this.emitRun(run, "status", { status });
  }
  async start(quest: Quest) {
    if (!quest.objective?.trim() || !quest.check?.trim())
      throw new Error(
        "A quest needs an objective and a checkable completion condition.",
      );
    if (quest.objective.length > 24000 || quest.check.length > 12000)
      throw new Error("Quest is too large.");
    if (
      !Array.isArray(quest.allowedPaths) ||
      !quest.allowedPaths.length ||
      quest.allowedPaths.some(
        (p) =>
          !p ||
          path.isAbsolute(p) ||
          p.split("/").includes("..") ||
          p.startsWith(".git"),
      )
    )
      throw new Error(
        "Specify relative allowed files or folders (folders end with /).",
      );
    const routed = quest.petId === "auto" ? routeLocal((await listPets()).pets, await receipts(), quest, this.petBusy) : null;
    const pet = routed?.pet || await getPet(quest.petId);
    quest = {...quest, petId:pet.id};
    if (pet.petshop.billing === "api" && quest.apiApproved !== true)
      throw new Error(
        "This pet uses metered API billing. Approve this specific launch first.",
      );
    // A free remote pet may scout and review unattended, but sending your code
    // to a third party AND letting it write are two separate decisions.
    if (
      pet.petshop.provider === "openrouter" &&
      pet.sandbox_mode !== "read-only" &&
      quest.remoteWriteApproved !== true
    )
      throw new Error(
        "This is a remote pet with write access. Your code leaves this machine and may be logged or trained on. Approve this specific launch first.",
      );
    if (
      quest.requiredEquipment?.some(
        (tool) => !pet.petshop.equipment.includes(tool),
      )
    )
      throw new Error(
        "The selected pet does not carry the quest’s required equipment.",
      );
    if (this.petBusy.has(pet.id))
      throw new Error("This pet already has an active quest.");
    if (quest.advisorId === pet.id)
      throw new Error("The advisor must be a different pet.");
    if (quest.advisorId) await getPet(quest.advisorId);
    this.petBusy.add(pet.id);
    let run: Run;
    try {
      const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
      const work = await createWorktree(expand(quest.repo), id);
      run = {
        id,
        quest: {
          ...quest,
          repo: expand(quest.repo),
          requiredEquipment: quest.requiredEquipment || [],
          taskType: quest.taskType || "implementation",
        },
        status: "queued",
        createdAt: new Date().toISOString(),
        ...work,
        events: [],
        pets: [pet.id],
      };
      this.runs.set(id, run);
      this.controllers.set(id, new AbortController());
      await this.persist(run);
      await this.emitRun(run, "quest", run.quest);
      if(routed) await this.emitRun(run, "routing", {message:routed.reason}, pet.id);
      const task = this.execute(run, pet)
        .catch(async (e) => {
          run.error = e.message;
          await this.state(run, "failed");
        })
        .finally(() => this.tasks.delete(run.id));
      this.tasks.set(run.id, task);
      return run;
    } catch (e) {
      this.petBusy.delete(pet.id);
      throw e;
    }
  }
  decide(id: string, option: string) {
    const d = this.decisions.get(id);
    if (!d) throw new Error("This decision has already finished.");
    if (!d.options.includes(option))
      throw new Error("Invalid decision option.");
    this.decisions.delete(id);
    d.resolve(option);
  }
  async ask(run: Run, data: any, petId: string, options: string[]) {
    const id = crypto.randomUUID();
    const result = new Promise<string>((resolve) =>
      this.decisions.set(id, { runId: run.id, options, resolve }),
    );
    await this.emitRun(run, "decision", { ...data, id }, petId);
    return result;
  }
  pending(runId?: string) {
    return [...this.decisions.entries()]
      .filter(([, d]) => !runId || d.runId === runId)
      .map(([id, d]) => ({ id, runId: d.runId, options: d.options }));
  }
  async cancel(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error("Run not found.");
    this.controllers.get(id)?.abort();
    for (const [key, d] of this.decisions)
      if (d.runId === id) {
        this.decisions.delete(key);
        d.resolve("cancelled");
      }
    for (const a of this.active.get(id) || [])
      a.rpc.notify("session/cancel", { sessionId: a.sessionId });
  }
  private async execute(run: Run, pet: Pet) {
    const control = this.controllers.get(run.id)!;
    const signal = control.signal;
    const actors: {
      pet: Pet;
      rpc: RpcProcess;
      sessionId: string;
      telemetry: string;
      start: number;
      response: any;
      providerCost: number | null;
      release?: () => Promise<void>;
    }[] = [];
    let checkPassed = false;
    let advisor: Pet | undefined;
    try {
      const loot = path.join(STATE, "loot", run.id);
      await fs.mkdir(loot, { recursive: true });
      const launch = async (p: Pet) => {
        const actor: any = {
          pet: p,
          start: Date.now(),
          response: null,
          providerCost: null,
        };
        actors.push(actor);
        if (p.petshop.billing === "local")
          actor.release = await this.gpu.acquire(
            `${run.id}:${p.id}`,
            p,
            signal,
            (s) => void this.emitRun(run, "activity", { message: s }, p.id),
          );
        if (signal.aborted) throw new Error("Cancelled.");
        const h = await createHarness(p, run.cwd, run.id);
        Object.assign(actor, h);
        signal.addEventListener(
          "abort",
          () => {
            if (actor.sessionId)
              h.rpc.notify("session/cancel", { sessionId: actor.sessionId });
            const t = setTimeout(() => h.rpc.close(), 1500);
            t.unref();
          },
          { once: true },
        );
        h.rpc.onNotification = (method, params) => {
          if (method === "session/update") {
            const u = params.update;
            if (
              u.sessionUpdate === "usage_update" &&
              u.cost?.currency === "USD"
            )
              actor.providerCost = u.cost.amount;
            void this.emitRun(run, "acp", u, p.id);
          }
        };
        h.rpc.onRequest = async (method, params) => {
          if (method !== "session/request_permission")
            throw new Error(`This client does not advertise ${method}.`);
          if (signal.aborted) return { outcome: { outcome: "cancelled" } };
          const opts = params.options || [];
          if (p.approval_policy === "never") {
            const selected = opts.find((o: any) =>
              p.sandbox_mode === "read-only"
                ? o.kind === "reject_once"
                : o.kind === "allow_once",
            );
            await this.emitRun(
              run,
              "approval",
              {
                automatic: true,
                policy: p.sandbox_mode,
                option: selected?.optionId || "cancelled",
              },
              p.id,
            );
            return selected
              ? {
                  outcome: { outcome: "selected", optionId: selected.optionId },
                }
              : { outcome: { outcome: "cancelled" } };
          }
          const option = await this.ask(
            run,
            {
              kind: "permission",
              title: params.toolCall?.title || "Tool permission",
              request: params,
              options: opts,
            },
            p.id,
            opts.map((o: any) => o.optionId),
          );
          await this.emitRun(run, "decision_resolved", { option }, p.id);
          return option === "cancelled"
            ? { outcome: { outcome: "cancelled" } }
            : { outcome: { outcome: "selected", optionId: option } };
        };
        await h.rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "petshop", version: "0.1.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        });
        const session = await h.rpc.request("session/new", {
          cwd: run.cwd,
          mcpServers: [],
          _meta: h.sessionMeta,
        });
        actor.sessionId = session.sessionId;
        const live = this.active.get(run.id) || [];
        live.push(actor);
        this.active.set(run.id, live);
        // Custom local model IDs are already set by the sheet; upstream's legacy
        // set_model rejects IDs absent from its hosted-model catalogue.
        if (p.petshop.harness === "claude")
          await h.rpc.request("session/set_model", {
            sessionId: actor.sessionId,
            modelId: p.model,
          });
        if (p.petshop.harness === "claude")
          await h.rpc.request("session/set_mode", {
            sessionId: actor.sessionId,
            modeId:
              p.sandbox_mode === "danger-full-access"
                ? "bypassPermissions"
                : p.sandbox_mode === "read-only"
                  ? "plan"
                  : "default",
          });
        await this.emitRun(
          run,
          "session",
          {
            sessionId: actor.sessionId,
            model: p.model,
            harness: p.petshop.harness,
            billing: p.petshop.billing,
            body: p.petshop.body,
          },
          p.id,
        );
        return actor;
      };
      const prompt = async (a: any, text: string) => {
        if (signal.aborted) throw new Error("Cancelled.");
        await this.emitRun(run, "prompt", { text }, a.pet.id);
        a.response = await a.rpc.request(
          "session/prompt",
          { sessionId: a.sessionId, prompt: [{ type: "text", text }] },
          30 * 60_000,
        );
        a.responses ||= [];
        a.responses.push(a.response);
        await this.emitRun(run, "turn_end", a.response, a.pet.id);
        if (a.response?._meta?.session_failure)
          throw new Error(JSON.stringify(a.response._meta.session_failure));
      };
      const check = async () => {
        await this.state(run, "checking");
        const c = await runCheck(run.cwd, run.quest.check, signal);
        run.checkOutput = c.output;
        await this.emitRun(run, "check", c);
        return c.ok;
      };
      const local = await launch(pet);
      await this.state(run, "running");
      await prompt(
        local,
        `${pet.developer_instructions}\n\nQuest: ${run.quest.objective}\n\nWorking directory: ${run.cwd}\nAllowed changes ONLY: ${run.quest.allowedPaths.join(", ")}\nCompletion check (owned by Petshop): ${run.quest.check}\nPreferred equipment: ${pet.petshop.equipment.join(", ")}\nLoot directory: ${loot}\n\nDo the work, explain progress briefly, and stop. Do not commit or change Git history. Do not read or modify your character sheet or Petshop state. If blocked, write ${loot}/help.md describing evidence and failed attempts. No nested agents.`,
      );
      if (local.release) {
        await local.release();
        local.release = undefined;
      }
      checkPassed = await check();
      if (!checkPassed && !signal.aborted && run.quest.advisorId) {
        advisor = await getPet(run.quest.advisorId);
        await this.state(run, "needs-help");
        const option = await this.ask(
          run,
          {
            kind: "consultation",
            title: `Consult ${advisor.name} once?`,
            evidence: run.checkOutput,
            billing: advisor.petshop.billing,
            model: advisor.model,
            options: [
              {
                optionId: "consult",
                name:
                  advisor.petshop.billing === "api"
                    ? "Approve metered API consultation"
                    : "Consult using subscription / local allowance",
              },
              { optionId: "stop", name: "End this quest" },
            ],
          },
          advisor.id,
          ["consult", "stop"],
        );
        await this.emitRun(run, "decision_resolved", { option }, advisor.id);
        if (option === "consult") {
          await this.emitRun(
            run,
            "approval",
            {
              kind: "consultation",
              approved: true,
              model: advisor.model,
              billing: advisor.petshop.billing,
              apiApproved: advisor.petshop.billing === "api",
            },
            advisor.id,
          );
          if (this.petBusy.has(advisor.id))
            throw new Error("Advisor is already on another quest.");
          this.petBusy.add(advisor.id);
          run.pets.push(advisor.id);
          await this.persist(run);
          await this.emitRun(run, "handoff", {
            from: pet.id,
            to: advisor.id,
            message: "The check failed. Passing the evidence to an advisor.",
          });
          const expert = await launch(advisor);
          await this.state(run, "consulting");
          await prompt(
            expert,
            `You are advising ${pet.name}. Give focused advice; do not edit files or commit.\nQuest: ${run.quest.objective}\nAllowed scope: ${run.quest.allowedPaths.join(", ")}\nFailed check output:\n${run.checkOutput}\nInspect the current work in ${run.cwd}. Additional evidence may be at ${loot}/help.md. Return a concise actionable answer for the local pet.`,
          );
          const advice = run.events
            .filter(
              (e) =>
                e.petId === advisor!.id &&
                e.type === "acp" &&
                e.data.sessionUpdate === "agent_message_chunk",
            )
            .map((e) => e.data.content?.text || "")
            .join("");
          const adviceFile = path.join(loot, "advice.md");
          await fs.writeFile(adviceFile, advice);
          if (expert.release) {
            await expert.release();
            expert.release = undefined;
          }
          if (pet.petshop.billing === "local")
            local.release = await this.gpu.acquire(
              `${run.id}:${pet.id}`,
              pet,
              signal,
              (s) => void this.emitRun(run, "activity", { message: s }, pet.id),
            );
          await this.state(run, "running");
          await this.emitRun(run, "handoff", {
            from: advisor.id,
            to: pet.id,
            message: "Advice is ready.",
            file: adviceFile,
          });
          await prompt(
            local,
            `The advisor's findings are in ${adviceFile}. Read that file, apply only changes within the original allowed scope, and finish. This is the final attempt for this quest. Do not commit.`,
          );
          if (local.release) {
            await local.release();
            local.release = undefined;
          }
          checkPassed = await check();
        }
      }
      if (signal.aborted) throw new Error("Cancelled.");
      if (checkPassed) {
        const commit = await commitBounded(
          run.cwd,
          run.baseCommit,
          run.quest.allowedPaths,
          pet.name,
        );
        if (commit) {
          run.commit = commit;
          await this.emitRun(run, "commit", { commit, branch: run.branch });
        }
        await this.state(run, "completed");
      } else await this.state(run, "failed");
    } catch (e) {
      run.error = (e as Error).message;
      await this.emitRun(run, "error", { message: run.error });
      await this.state(run, signal.aborted ? "cancelled" : "failed");
    } finally {
      if (!actors.length)
        actors.push({
          pet,
          start: Date.now(),
          response: null,
          providerCost: null,
        } as any);
      run.receipt = [];
      for (const actor of actors) {
        actor.rpc?.close();
        if (actor.release) await actor.release();
        const stats = actor.telemetry
          ? await readTelemetry(actor.telemetry)
          : {
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              realCost: null,
              limits: null,
            };
        const responses = (actor as any).responses || [];
        const usages = responses.map((r: any) => r.usage).filter(Boolean);
        const u = usages.length
          ? usages.reduce(
              (sum: any, u: any) => ({
                inputTokens: sum.inputTokens + (u.inputTokens || 0),
                cachedReadTokens:
                  sum.cachedReadTokens + (u.cachedReadTokens || 0),
                outputTokens: sum.outputTokens + (u.outputTokens || 0),
                totalTokens: sum.totalTokens + (u.totalTokens || 0),
              }),
              {
                inputTokens: 0,
                cachedReadTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
            )
          : null;
        const r: Receipt = {
          runId: run.id,
          petId: actor.pet.id,
          fingerprint: actor.pet.fingerprint,
          taskType: run.quest.taskType,
          billing: actor.pet.petshop.billing,
          model: actor.pet.model,
          harness: actor.pet.petshop.harness,
          status: run.status,
          inputTokens:
            stats.inputTokens ??
            (typeof u?.inputTokens === "number"
              ? u.inputTokens + (u.cachedReadTokens || 0)
              : null),
          outputTokens: stats.outputTokens ?? u?.outputTokens ?? null,
          totalTokens: stats.totalTokens ?? u?.totalTokens ?? null,
          marginalCostUsd:
            actor.pet.petshop.billing === "api"
              ? (stats.realCost ?? actor.providerCost)
              : 0,
          providerCostUsd: stats.realCost ?? actor.providerCost,
          elapsedSeconds: (Date.now() - actor.start) / 1000,
          checkPassed: checkPassed && run.status === "completed",
          xp: checkPassed && run.status === "completed" ? 1 : 0,
          commit: run.commit,
        };
        await record(r);
        run.receipt.push(r);
        await this.emitRun(run, "receipt", r, actor.pet.id);
      }
      run.finishedAt = new Date().toISOString();
      await this.persist(run);
      await this.emitRun(run, "finished", { status: run.status });
      this.active.delete(run.id);
      this.controllers.delete(run.id);
      this.petBusy.delete(pet.id);
      if (advisor) this.petBusy.delete(advisor.id);
    }
  }
  async shutdown() {
    for (const id of this.controllers.keys()) await this.cancel(id);
    await Promise.allSettled([...this.tasks.values()]);
    await this.gpu.stop();
  }
}
