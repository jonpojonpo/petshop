import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { STATE } from "./paths.ts";
import type { Pet } from "./types.ts";

export class GpuScheduler {
  owner: string | null = null;
  waiting: string[] = [];
  model: string | null = null;
  process: ChildProcess | null = null;
  private tail: Promise<void> = Promise.resolve();
  constructor(private lockPath = path.join(STATE, "gpu.lock")) {}
  snapshot() {
    return {
      owner: this.owner,
      waiting: [...this.waiting],
      model: this.model,
      managed: !!this.process,
      pid: this.process?.pid || null,
    };
  }
  async acquire(
    id: string,
    pet: Pet,
    signal: AbortSignal,
    onState: (s: string) => void,
  ): Promise<() => Promise<void>> {
    this.waiting.push(id);
    onState("Waiting for the GPU");
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((r) => (unlock = r));
    let cancel!: () => void;
    const cancelled = new Promise<boolean>((resolve) => {
      cancel = () => resolve(false);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
    const ready = await Promise.race([previous.then(() => true), cancelled]);
    signal.removeEventListener("abort", cancel);
    this.waiting = this.waiting.filter((x) => x !== id);
    if (!ready || signal.aborted) {
      void previous.then(unlock);
      throw new Error("Cancelled while queued.");
    }
    let locked = false;
    try {
      for (let tries = 0; tries < 2; tries++) {
        try {
          await fs.writeFile(this.lockPath, `${process.pid}`, {
            flag: "wx",
            mode: 0o600,
          });
          locked = true;
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          const pid = Number(await fs.readFile(this.lockPath, "utf8"));
          let alive = true;
          try {
            process.kill(pid, 0);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ESRCH") alive = false;
          }
          if (alive)
            throw new Error("Another Petshop process holds the GPU lease.");
          await fs.unlink(this.lockPath);
        }
      }
      if (!locked) throw new Error("Could not acquire GPU lease.");
      this.owner = id;
      await this.ensureModel(pet, signal, onState);
      let done = false;
      return async () => {
        if (done) return;
        done = true;
        this.owner = null;
        await fs.unlink(this.lockPath).catch(() => {});
        unlock();
      };
    } catch (e) {
      this.owner = null;
      if (locked) await fs.unlink(this.lockPath).catch(() => {});
      unlock();
      throw e;
    }
  }
  async ensureModel(
    pet: Pet,
    signal: AbortSignal,
    onState: (s: string) => void,
  ) {
    const endpoint = pet.petshop.endpoint || "http://127.0.0.1:8080/v1";
    const health = async () => {
      try {
        const r = await fetch(endpoint + "/models", {
          signal: AbortSignal.timeout(1800),
        });
        const d = (await r.json()) as any;
        return r.ok && d.data?.some((m: any) => m.id === pet.model);
      } catch {
        return false;
      }
    };
    if (this.process && this.model !== pet.petshop.model_identity)
      await this.stop();
    if (await health()) {
      this.model = pet.petshop.model_identity;
      onState("GPU ready");
      return;
    }
    // A different listener is external: never replace it or start over it.
    try {
      const r = await fetch(endpoint + "/models", {
        signal: AbortSignal.timeout(1800),
      });
      if (r.ok)
        throw new Error(
          "The model endpoint is running a different model. Stop it or select its sheet.",
        );
    } catch (e) {
      if ((e as Error).message.includes("different model")) throw e;
    }
    if (!pet.petshop.launch_command)
      throw new Error(
        "Local model is offline. Add its launcher to the sheet or start the server.",
      );
    onState("Uncaging the local model");
    const log = await fs.open(path.join(STATE, "model.log"), "a", 0o600);
    this.process = spawn(
      pet.petshop.launch_command,
      pet.petshop.launch_args || [],
      { stdio: ["ignore", log.fd, log.fd], detached: true },
    );
    await log.close();
    this.model = pet.petshop.model_identity;
    let error: string | undefined;
    this.process.on("error", (e) => (error = e.message));
    const child = this.process;
    for (let i = 0; i < 120; i++) {
      if (signal.aborted) {
        await this.stop();
        throw new Error("Cancelled while loading the model.");
      }
      if (error || child.exitCode !== null) {
        this.process = null;
        throw new Error(
          error || "Model launcher exited; see .petshop/model.log.",
        );
      }
      if (await health()) {
        onState("GPU ready");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await this.stop();
    throw new Error("Local model did not become ready within two minutes.");
  }
  async stop() {
    const child = this.process;
    if (!child) return;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    await Promise.race([
      new Promise<void>((r) => child.once("exit", () => r())),
      new Promise<void>((r) => setTimeout(r, 4000)),
    ]);
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    this.process = null;
    this.model = null;
  }
}
