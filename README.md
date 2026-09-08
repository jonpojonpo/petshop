# Petshop

A local ACP conductor and character creator for coding companions. Import a body,
give it a Codex-compatible TOML sheet, choose its harness and access, and send it
on a bounded Git quest. The upstream harness owns inference and tools; Petshop
owns scheduling, visible handoffs, completion checks, and receipts.

## Open the shop

Requires Node 22+, Git, and an existing Codex or Claude subscription login for
subscription pets. Local inference uses your own OpenAI-compatible model server.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4321**. For development, use `npm run dev`.
The service binds to loopback and rejects foreign browser origins.

Four views are available:

- **Shop:** live Codex sheets, imported bodies, searchable companions, and community adoption.
- **Creator:** name, body, model, harness, provider/billing, equipment, access, and temperament.
- **Run:** independent pet tabs, real streamed tool/progress events, approvals, checks, and commits.
- **Ledger:** tokens, reported API charges, subscription allowance and reset windows, and receipts.

## Imports and character sheets

Existing `~/.codex/agents/*.toml` and `~/.codex/pets/*/pet.json` are discovered on
startup or **Rescan Codex**. The installed desktop app's nine bundled bodies are
read from its ASAR archive and cached locally; their artwork is not redistributed
in this repository. Unknown TOML fields survive import/export.

Petshop adds a `[petshop]` table to the normal agent sheet; native model,
instructions, sandbox, and approval fields stay at the root. New sheets are
written directly to the Codex agents folder. A new Juno conductor variant is
seeded without altering the original `qwen_local` or `luna_scout` sheets.

The local default is JP's existing **HauhauCS Qwen3.8-27B Uncensored Aggressive +
FastMTP** launcher at `~/speed-qwen/run-server.sh`. The creator lets you select a
different endpoint or launcher. The weights and launcher are not modified.

**Community adoption** uses [codex-pets.net](https://codex-pets.net). Search, enter
a slug such as `nyan-cat`, or preview a collection such as `cats`. Adoption
validates the ZIP manifest and transparent 1536×2288 v2 atlas, installs only
`pet.json` and `spritesheet.webp`, retains creator attribution, and rejects
duplicate IDs. A community body grants no agent permissions. Artwork retains
its creator's terms; the catalog CLI's software license does not license artwork.

Hatching is deferred. The existing deterministic pipeline remains in `hatch/`.

## Quests and Git boundaries

Choose a clean Git repository, an objective, a shell completion check, and an
allowed file list. Use trailing `/` for a whole folder. Petshop creates a branch
and worktree, runs the pet there, executes the check itself, and commits only if
the check passes and all changed files fall within the allowed scope. Changes to
Git history or symlinks prevent automatic commits. The main branch is never
automatically merged. Failed or cancelled worktrees remain inspectable.

An optional advisor is consulted once after a failed check and human approval.
Advice is written to the quest's loot directory and passed back by reference.
The original pet gets one final attempt. There is no home-grown model/tool loop.

Native harness permissions are selectable: read-only, workspace write, or full
access/YOLO, plus approval policy. Git bounds constrain automatic commits; they
are **not an OS sandbox**. Equipment guides task eligibility and tool choice;
a shell-enabled harness can execute other installed tools. Petshop never claims
that ACP intercepts every native filesystem operation.

Only one Petshop local prompt holds the GPU lease. Petshop starts its own model
process when needed and leaves unrelated processes alone. Cancelling a quest
cancels its harness and check; shutdown stops Petshop-owned model processes.

## Billing and account usage

- **Local:** no hosted model calls; token counts come from the harness telemetry.
- **Subscription:** existing ChatGPT/Claude login with ambient API overrides removed.
- **API:** requires explicit approval for that quest or advisor consultation.

Codex limits come from `account/rateLimits/read`. Claude limits come from its
adapter's local `/usage` command, which refreshes authentication without model
inference. Account windows include usage outside Petshop and are cached for
three minutes. Unknown costs and missing windows are displayed as unreported.
Subscription allowance is distinct from API pricing; account-level extra usage
or purchased credits are governed by your provider's plan.

Receipts and events live under `.petshop/`, which is ignored by Git. XP is awarded
only after the independent completion check and scoped to the model/harness
identity; the pet is not given its sheet. API cost is recorded only when a
provider actually reports it; no synthetic savings or price-table estimates.

## Use from an ACP editor

Keep the web conductor running, then configure your ACP editor to start:

```json
{
  "command": "node",
  "args": ["--import", "/absolute/path/petshop/node_modules/tsx/dist/loader.mjs", "/absolute/path/petshop/server/stdio.ts"],
  "env": {"PETSHOP_URL": "http://127.0.0.1:4321"}
}
```

Or run `npm run --silent acp` in this directory. Select a pet using the session's
mode selector. Send a structured quest:

```json
{"objective":"Document the public exports", "check":"test -s docs/exports.md", "allowedPaths":["docs/exports.md"]}
```

For ordinary prompts, set `PETSHOP_CHECK`, `PETSHOP_ALLOWED_PATHS` (comma-separated),
and optionally `PETSHOP_PET` in the editor's agent environment. The session's `cwd`
is the target Git repository. Approval prompts are forwarded to the editor and
also appear in the local shop. This first version supports new sessions and
cancellation, not ACP history resumption, image prompts, or remote filesystems.

## Configuration and development

`PORT` changes the HTTP port. `PETSHOP_STATE`, `PETSHOP_CODEX_HOME`, and
`PETSHOP_ASAR` override local storage/import locations. Routing, model identity,
billing, equipment, and launch configuration stay on each sheet.

```sh
npm test
npm run build
```

The transport compatibility code is deliberately small: `codex-policy.mjs`
applies the selected native sandbox policy and records telemetry beneath the
upstream ACP bridge; `local-transport.ts` normalizes system/developer placement
for Qwen's chat template. Neither executes tools or implements an agent loop.
