# petshop

A home for useful, characterful agent companions. Solo pets come first: chat, research, browse, keep notes and make things. Coding is one capability, not the whole personality. You adopt and create **pets** — named, bounded
agents with a model, a temperament and a leash — and petshop runs them and holds
the leash. It contains no agent loop of its own and never will.

The local model conducts. Frontier models are consulted, not employed.

## Why

Every commercial harness bills frontier tokens for work a 27B model on your own
GPU can do. None will ship the scheduler that avoids that, because it sells
fewer tokens. That is the wedge, and the only part an incumbent cannot copy.

## The machine

Verifiable facts. Check them, don't guess.

- RTX 4090 (24 GB), i5-12400, 62 GB RAM.
- `~/speed-qwen` — Qwen3.8-27B tuned to **70.7 t/s** with MTP self-speculation,
  128K context. **One inference sequence at a time.** See its `RESULTS.md`.
- A **local vision model** is on disk and works: `gemma-4-12B-it` Q4 plus its
  projector, served by `llama.cpp/llama-server`, judges sprite look-directions
  at **0.10 s** per verdict in ~10 GB. Measured here; see `hatch/README.md`.
- `claude`, `codex`, `pi`, `crush` installed. **None speak ACP natively.** Real
  surfaces: `codex app-server` (stdio JSON-RPC), `claude -p --output-format
  stream-json`, `pi --mode rpc`; `crush` has pipes only. Upstream adapters exist
  for the first three — evaluate before writing one.
- **Thirteen pets already live inside Codex**, extracted to `pets/codex-pets.json`
  by `pets/extract-codex-pets.py`. Two are agent pets in `~/.codex/agents/*.toml`
  — `luna_scout` and `qwen_local`; they work. Nine are sprite companions bundled
  in the desktop app, and two — `juno`, `chika` — were hatched here into
  `~/.codex/pets/`. All thirteen are trapped inside Codex, and freeing them is
  the point.

## Shape

petshop is an **ACP proxy** — a client downward to the pets, an agent upward, so
any ACP editor can drive the shop. It owns exactly one surface of its own: a
**web GUI**, the shop front. An editor is where you spend a pet. The shop front
is where you acquire, create and compare them, and no ACP editor will ever
render that.

The protocol hands you the key inversion: in ACP the *client* serves the
filesystem, the terminals and the permission prompts. Every file a pet reads,
every command it runs, every permission it asks for crosses one process.
Locking, audit, cost metering and GPU scheduling all live at that choke point.
Don't scatter them.

One subprocess and one session per pet. That is also the UI: one pet, one tab.

A **party** is small and complementary — six is a ceiling, not a target, and two
pets that work the same way are one pet. Because the conductor owns the
filesystem it also owns the **loot**: findings and artifacts a pet produces are
left in a scratch area and handed to the next pet by reference, not pasted into
its context. That is cclient4's one orphaned good idea, and it is the main
reason a party is cheaper than a long conversation.

## A pet

A pet is **data, not code**, and its character sheet **is** the routing table —
every stat is a field the conductor reads to decide who gets the job.

| stat | what it is |
|---|---|
| **speed** | tokens/sec, measured here, never declared |
| **memory** | context window |
| **upkeep** | cost per Mtok — zero for locals, real money for beasts |
| **equipment** | the tools it carries — the main thing that makes pets differ |
| **alignment** | lawful↔chaotic: does it ask before acting. good↔evil: will it refuse |
| **habitat** | GPU, API key, network |
| **temperament** | the prose, as `developer_instructions` is today |
| **XP** | record per task type: scouting, reading, implementation, review, synthesis, shell |

The `~/.codex/agents/*.toml` files are the seed schema. Import them; don't invent
a format.

**Equipment differentiates pets more than models do.** Models are expensive and
converging; tools are cheap and composable. A scout that browses with `w3m`
reads the web as text on a token budget no headless-Chrome pet can touch, and
`w3m`, `rg`, `tree`, `sqlite3`, `git` and `gh` are already on this machine.
Equipping a pet is the cheap move and upgrading its model is the expensive one;
constraint 3 says try the cheap one first. **Skills** are what a pet is good at
and are earned; **equipment** is what it carries and is chosen.

**The shop keeps the record; a pet never sees its own sheet.** XP is awarded from
outcomes the conductor observes — tests passed, a reviewing pet accepted the
work, the stuck detector tripped — because a pet that can read its own stats will
optimise them. It is scoped to a model-and-harness pair and decays when either
changes; cclient6 died to exactly such a withdrawal.

Frontier pets are caged beasts: opening the cage is deliberate, and the ledger
records it. Locals are free to keep and should outnumber them.

**The creator is v1.** Design the stat block now — it is the schema — and build
the character-creation screen against it, not after it. The old objection was
that a creator with two pets in it is a screensaver. The extraction settled it:
Codex is already holding **thirteen** (`pets/codex-pets.json`). Two are agent
pets with a model and a leash; eleven are bodies — nine bundled with the desktop
app, two hatched here. The shop is not empty.

## The shop front

The GUI is a **web** GUI, served by the conductor and opened in a browser. Not
Electron, not a TUI: a stat block is a form and a bestiary is a grid of cards,
and HTML has been good at both for thirty years.

Four screens, and it is done when they exist:

- **The shop** — every pet as a card: body, stats, XP, leash, upkeep. Sortable by
  any column, because the column *is* the routing table.
- **The creator** — the stat block as a form. Name it, pick its equipment, set
  the leash, write the temperament, give it a body. Save writes a
  `~/.codex/agents/*.toml`, so a pet born here still runs inside Codex.
- **The run** — one pet, one tab, streaming. cclient3's UI, still the target.
- **The ledger** — the receipt from constraint 4, on a screen instead of only in
  a terminal.

**Creating pets is the fun part, and the creator is allowed to be fun.** It is
the one place in this project where delight beats parsimony: rolling a new pet
should feel like character creation, not like editing YAML. That is not
decoration — a shop you enjoy stocking is a shop that gets a third local pet
before it gets a second frontier one, which is constraint 3 enforced by pleasure
instead of discipline.

A pet has two halves and the creator makes both. The **sheet** is
`~/.codex/agents/*.toml` — import it, don't invent it. The **body** is the v2
sprite atlas: 1536x2288, an 8x11 grid of 192x208 cells, nine animation rows and
sixteen look directions. Codex's `hatch-pet` skill builds one, and `hatch/` is
that skill with the host cut off it — the deterministic pipeline vendored
unchanged, the two model-shaped steps turned into named roles.

**Hatching has exactly two holes that need a model**: something to generate an
image, and something to look at one and answer a bounded question. The second is
thirty short judgements per pet, it is where the frontier tokens went, and a 12B
model on this GPU does it in a tenth of a second each. That is constraint 3
holding in the one place nobody thinks to look for it — a mascot pipeline — and
it is why the creator can afford to be generous with QA. The first hole stays
hosted for now, on evidence rather than preference: `hatch/MODELS.md`.

Hatching is still slow, so the creator offers the eleven existing bodies first
and treats hatching as the deliberate move.

The shop front holds no state of its own. Constraint 7 has no exception for the
thing with the buttons: the sheets and the ledger are the truth, and every screen
is a view over them.

## Quests

Work arrives as a **quest**, not a prompt. A quest carries an objective, a
difficulty, a party, and — the part that matters — a **completion condition the
conductor can check without asking a pet**: a test that passes, a build that
holds, a file that exists, a diff a reviewing pet accepts.

That condition is not ceremony. It is where XP comes from, and it is what lets
difficulty drive routing, so a trivial quest never wakes a beast. A quest that
cannot state a checkable condition is one a human should keep. Sub-quests go to
party members with their own conditions and their own loot.

## The bestiary

New models appear in `/v1/models` on their own. When one does, a scout pet
researches it — published evals, model card, refusal and alignment posture,
pricing — and drafts a stat block. The shop writes its own bestiary entries;
`luna_scout` already does exactly this kind of sourced research, and cclient7
already does the `/v1/models` discovery and caching.

**A drafted sheet is a hypothesis, not a measurement.** Published evals are
marketing-adjacent and contaminated, and they say nothing about your tasks.
Speed is measured here or not recorded. A new arrival enters unproven, on the
tightest leash, and earns its stats from observed outcomes — widening the leash
stays the user's deliberate act, never an automatic reward. Label a pet's
refusal posture loudly: knowing you have an unguardrailed model in the shop is
the point of the alignment column.

## Constraints

The taste. These matter more than any feature.

1. **Never write an agent loop.** If a pet can do the work, the pet does it. An
   adapter that grows a tool loop, a renderer or a model table is a bug. This is
   the entire reason the project exists.
2. **One pet holds the GPU.** The scheduler is not a later phase.
3. **A frontier token is a bug until proven necessary.** Escalate on evidence,
   and record the evidence.
4. **Every run ends with a receipt** — per pet and total, actual against
   frontier-only. Unprinted means it didn't happen.
5. **Adapters are thin and disposable.** Upstream will absorb them. Own the
   conductor, borrow the bridges.
6. **Prefer deleting a pet to adding a feature.**
7. **The sheet is the config.** A stat no scheduler reads gets deleted; a field
   the conductor reads goes on the sheet. There is no second, hidden config.
8. **XP is awarded, never claimed** — and it decides who gets picked, never what
   they may do. Permission comes from the leash, which is the user's choice.

## Done, for v0

One task, two pets, two tabs, one receipt.

`qwen_local` conducts against a real repository here. One frontier pet is
consulted exactly once, when the local pet is genuinely stuck. Both stream into
their own tab. The run ends with the ledger, against the real CLIs, not a mock.

Resist pet number three until this has been used for a week.

## Prior art

Seven attempts in `~/cclient*`. The lesson is in the failure, not the code.

- **cclient** — the aesthetic. Banners and themes survived every rewrite;
  nothing else did.
- **cclient3** (9.3k) — sub-agents in tabs, genuinely good, and the UI target
  here. Died of feature parity with a product that ships weekly.
- **cclient4** (5.2k) — agents inside SQLite. Orphaned good idea: chain tool
  calls through a scratch workspace without paying context for the intermediates.
- **cclient5** (1.1k, one file) — this same conductor, four months early, killed
  by driving CLIs through PTY scraping. ACP is the fix. Its longest vision
  document produced its smallest program.
- **cclient6** (1.6k) — the cost ladder, the ledger, and a stuck detector worth
  reusing as an XP signal. Killed by a model withdrawal, not by design.
- **cclient7** (10.3k, 253 tests) — best engineered, no vision document at all,
  a page of constraints instead. Not a coincidence, and why this file is short.

Each rewrote the agent loop from zero, and each ended the day its vision was
satisfied rather than the day it became worth reaching for. petshop breaks that
by never writing the loop.
