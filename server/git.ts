import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, STATE } from "./paths.ts";
const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], { maxBuffer: 8 * 1024 * 1024 })
  ).stdout.trim();
}
export async function createWorktree(repo: string, id: string) {
  const root = await git(repo, "rev-parse", "--show-toplevel");
  if (path.resolve(root) !== path.resolve(repo))
    throw new Error("Select the Git repository root.");
  if (await git(repo, "status", "--porcelain"))
    throw new Error(
      "Commit or stash the repository changes before starting a quest. Each quest starts from a clean commit.",
    );
  const baseCommit = await git(repo, "rev-parse", "HEAD");
  const branch = `petshop/${id}`;
  const cwd = path.join(STATE, "worktrees", id);
  await fs.mkdir(path.dirname(cwd), { recursive: true });
  await git(repo, "worktree", "add", "-b", branch, cwd, baseCommit);
  // Dependencies are shared read-only by convention; agent work is kept on its branch.
  if (repo === ROOT) {
    try {
      await fs.symlink(
        path.join(ROOT, "node_modules"),
        path.join(cwd, "node_modules"),
        "dir",
      );
    } catch {}
  }
  return { cwd, branch, baseCommit };
}
export function allowedFile(file: string, allowed: string[]) {
  if (
    path.isAbsolute(file) ||
    file.split("/").includes("..") ||
    file.startsWith(".git")
  )
    return false;
  return allowed.some((p) =>
    p.endsWith("/") ? file.startsWith(p) : file === p,
  );
}
export async function commitBounded(
  cwd: string,
  base: string,
  allowed: string[],
  petName: string,
) {
  if ((await git(cwd, "rev-parse", "HEAD")) !== base)
    throw new Error(
      "Pet changed Git history. The worktree is preserved for review; no automatic commit.",
    );
  const raw = (
    await exec(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  ).stdout;
  const files: string[] = [];
  const entries = raw.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const status = entry.slice(0, 2);
    files.push(entry.slice(3));
    if (status.includes("R") || status.includes("C")) files.push(entries[++i]);
  }
  const unique = [...new Set(files)];
  const outside = unique.filter((f) => !allowedFile(f, allowed));
  if (outside.length)
    throw new Error(
      `Change exceeded the quest boundary: ${outside.join(", ")}`,
    );
  if (!unique.length) return null;
  for (const f of unique) {
    const s = await fs.lstat(path.join(cwd, f)).catch(() => null);
    if (s?.isSymbolicLink())
      throw new Error(`Refusing an automatic commit of symlink ${f}.`);
  }
  await git(cwd, "add", "--", ...unique);
  await git(cwd, "commit", "-m", `pet: ${petName} completes a bounded quest`);
  return git(cwd, "rev-parse", "HEAD");
}
export function runCheck(
  cwd: string,
  command: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; output: string }> {
  if (signal.aborted)
    return Promise.resolve({
      ok: false,
      output: "Check cancelled before execution.",
    });
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    const collect = (d: Buffer) => {
      output = (output + d.toString()).slice(-48_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const kill = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    };
    const timer = setTimeout(() => {
      output += "\nCheck timed out after 120 seconds.";
      kill();
    }, 120_000);
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({ ok: code === 0 && !signal.aborted, output });
    });
  });
}
