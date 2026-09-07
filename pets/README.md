# The pets currently in Codex

Extracted 2026-09-07 by `extract-codex-pets.py`, machine-readable in
`codex-pets.json`. Re-run it after hatching; it is a snapshot, not a fixture.

Codex keeps "pet" in three places, and only the first has a stat block.

## Agent pets — 2

`~/.codex/agents/*.toml`. A model, a leash, a temperament. This is the seed
schema for the sheet; copies live verbatim in `seeds/`.

| name | model | provider | context | leash | role |
|---|---|---|---|---|---|
| `luna_scout` | `gpt-5.6-luna` | default (frontier) | default | `read-only`, effort `low` | bounded exploration, docs lookup, evidence |
| `qwen_local` | `speed-qwen-27b` | `speed_qwen` @ `127.0.0.1:8080` | 98304 | `read-only`, effort `low` | second opinions, code paths, review |

Both are read-only and both refuse to spawn further agents — they are already
shaped like leashed pets rather than harnesses. `qwen_local` is the free one and
the intended conductor.

## Hatched sprite pets — 2

`~/.codex/pets/<id>/{pet.json,spritesheet.webp}`. Bodies, no stats.

| id | name | description |
|---|---|---|
| `juno` | Juno | a thoughtful plush fox-owl, quiet purpose, warm spark |
| `chika` | Chika | cheerful pink-haired companion, bright and expressive |

`chika` is the currently selected desktop avatar
(`desktop.selected-avatar-id = "custom:chika"`).

## Bundled sprite pets — 9

Read out of `/usr/lib/chatgpt/resources/app.asar`. Ship with the desktop app.

| id | name | description |
|---|---|---|
| `bsod` | BSOD | a tiny blue-screen gremlin |
| `codex` | Codex | the original Codex companion |
| `dewey` | Dewey | a calm companion for focused workspace days |
| `fireball` | Fireball | hot path energy for fast iteration |
| `hoots` | Hoots | a sharp-eyed owl for polished work in a blink |
| `null-signal` | Null Signal | quiet signal from the void |
| `rocky` | Rocky | a steady rock when the diff gets large |
| `seedy` | Seedy | small green shoots for new ideas |
| `stacky` | Stacky | a balanced stack for deep work |

## The body contract

`spriteVersionNumber: 2`, atlas 1536x2288, 8 columns x 11 rows of 192x208 cells,
transparent background. Rows 0-8 are idle, running-right, running-left, waving,
jumping, failed, waiting, running, review. Rows 9-10 are sixteen clockwise look
directions starting at 000 = up; front is a deadzone that falls back to idle.
Unused cells after a row's last used column must be fully transparent. Full
contract and per-row frame durations: `../hatch/references/`, and `../hatch/` is
the pipeline that builds one without Codex.

## What the shop takes from this

The sheet is the toml — import it, don't invent it. The body is the atlas, and
eleven already exist, so the creator can offer a body without hatching one.
Nothing here records speed, upkeep, equipment or XP; those are stats the shop
measures and awards, never fields Codex hands over.
