# Hatching a pet

How to turn a concept into a v2 sprite atlas, without Codex.

This is the streamlined replacement for Codex's 923-line `hatch-pet` SKILL.md.
The deterministic scripts are vendored verbatim from it and are not the
interesting part of the extraction — they were already pure Pillow. The
interesting part is that only **two** steps in a pet run need a model at all:

| role | what it does | how often |
|---|---|---|
| **image** | make a picture from a prompt plus reference images | 13 jobs |
| **vision** | look at a picture, answer a bounded question | ~30 judgements |

Everything else — extraction, registration, mirroring, composition, despill,
geometry validation, contact sheets, previews — is deterministic image
processing that runs on stdlib and Pillow and needs no model, no API key, and
no network. Codex bound both roles to `$imagegen` and to its own subagents.
Here they are two lines in `backends.toml`, and anything that can fill a role
can hatch a pet.

**The vision role is the one to run locally.** Thirty small bounded questions —
"is this gaze up or down", "does this loop reverse", "is this cell empty" — is
exactly the work a 12B model with a projector does on your own GPU, and it is
where the frontier tokens in a hatch run actually go. Constraint 3 applies to
pet creation like anything else.

## Before you start

```bash
python3 backends.py probe     # are the configured backends reachable
python3 smoke.py              # does the deterministic pipeline still work
```

`smoke.py` hatches a pet from flat synthetic strips with no model in the loop.
If it passes, everything below is a backend problem, not a pipeline problem.

## The contract

`references/codex-pet-contract.md` and `references/animation-rows.md` are
authoritative and vendored unchanged. In short: an `8x11` atlas of `192x208`
cells, `1536x2288`, transparent background, `spriteVersionNumber: 2`. Rows 0-8
are idle, running-right, running-left, waving, jumping, failed, waiting,
running, review. Rows 9-10 are sixteen clockwise look directions where `000`
means **up**, not front; front is a deadzone that falls back to idle.

The `1536x1872` 8x9 atlas is an assembly intermediate. Never package it.

## The job graph

`prepare_pet_run.py` writes a run folder, one prompt per job, layout guides,
and `imagegen-jobs.json` with 13 visual jobs:

    base -> the 9 standard rows -> look-cardinals -> look-row-9 -> look-row-10

- Only `base` may be prompt-only. **Every other job must attach its reference
  images**, or the pet's identity drifts between rows. An image backend that
  silently ignores references is worse than one that errors; `backends.py`
  refuses to send references to a backend not declared as supporting them.
- `running-left` is the one deterministic derivation: mirror `running-right`,
  but only after `running-right` has been generated and approved as safe to
  mirror. Handedness and props break this often enough to be worth the look.
- No other state may be derived from another. `waiting`, `running`, `failed`,
  `review`, `jumping`, `waving` have distinct app semantics.

## Workflow

```bash
RUN=/path/to/run
KEY=$(python3 -c "import json;print(json.load(open('$RUN/pet_request.json'))['chroma_key']['hex'])")

python3 scripts/prepare_pet_run.py --pet-name "<Name>" \
  --description "<one sentence>" --output-dir "$RUN"
```

Then, per job: read `prompts/<job>.md`, call the **image** backend with the
prompt and the job's `input_images`, copy the chosen candidate to the job's
`output_path` under `decoded/`, and only then mark the job complete. Extract
and inspect each row as it lands rather than batching QA to the end:

```bash
python3 scripts/extract_strip_frames.py --decoded-dir "$RUN/decoded" \
  --output-dir "$RUN/frames" --states "$JOB" --method auto
python3 scripts/inspect_frames.py --frames-root "$RUN/frames" \
  --json-out "$RUN/qa/review.json" --states "$JOB" --require-components
```

Errors are a repair request. Repair the failing row, not the sheet.

Once rows 0-8 pass, compose the intermediate atlas, then assemble v2 and clean
the chroma edges exactly once:

```bash
python3 scripts/compose_atlas.py --frames-root "$RUN/frames" \
  --output "$RUN/final/standard.png"

python3 scripts/assemble_extended_atlas.py --base-atlas "$RUN/final/standard.png" \
  --look-row-9 "$RUN/decoded/look-row-9.png" \
  --look-row-10 "$RUN/decoded/look-row-10.png" \
  --chroma-key "$KEY" --output "$RUN/final/spritesheet.png" \
  --webp-output "$RUN/final/spritesheet.webp"

python3 scripts/despill_chroma_edges.py "$RUN/final/spritesheet.png" \
  --chroma-key "$KEY" --output "$RUN/final/spritesheet.png" \
  --webp-output "$RUN/final/spritesheet.webp" --json-out "$RUN/qa/despill.json"

python3 scripts/validate_atlas.py "$RUN/final/spritesheet.webp" \
  --require-v2 --chroma-key "$KEY"
```

One despill pass, after v2 assembly, and it is the *only* chroma authority.
Once its report says `ok: true` and the atlas validates, chroma QA is closed —
do not regenerate imagery over a colour fringe.

## Look directions, which is where runs actually fail

Generate in this order and no other:

1. **Four cardinals first** — `000` up, `090` screen-right, `180` down, `270`
   screen-left — as one strip. Extract with `extract_cardinal_anchors.py`,
   compose with `compose_cardinal_anchor_strip.py`, and get the vision backend
   to approve all four at final pet size. Cardinals are hard gates.
2. **Row 9 as one coherent eight-pose row** from those approved cardinals,
   interpolating the intermediates as even 22.5-degree steps. Register it, run
   edge and semantic QA immediately.
3. **Row 10 only after row 9 passes**, attaching both the cardinals and the
   finished row 9 so identity, scale and registration carry over.

Never ask a model for a whole `8x11` atlas. Never patch a single failed look
cell into a finished row — regenerate the containing row, because a one-off
cell will not match its neighbours and the loop will visibly snap.

## The QA gates, and which ones are hard

Ask the **vision** backend, one bounded question at a time. Constrain the
answers — `backends.py judge --choices` rejects an ambiguous reply rather than
guessing, which is what makes a small local model usable here.

| gate | hard? |
|---|---|
| `qa/review.json` has no errors | hard |
| atlas validates `--require-v2`, despill reports `ok: true` | hard |
| four cardinals semantically correct | hard |
| blind axis classification, 3 isolated judges, strict majority | hard on cardinals |
| all 16 directions have an explicit pass/warning/fail verdict | hard |
| intermediate direction uncertainty | warning |
| adjacent-frame continuity metrics | evidence, not a verdict |
| identity or style drift across rows | hard, even with clean validation |

**Blind means blind.** The judge classifying a randomized A/B direction sheet
must not have seen the degree labels, the answer key, or another judge's
verdict. A judge that already read the labelled sheet is not independent
evidence, and reusing one is the easiest way to fake this gate. Run
`make_direction_blind_qa_sheet.py`, collect three isolated verdicts, combine
with `combine_direction_blind_verdicts.py`, and check with
`validate_direction_blind_verdicts.py`.

This is also the strongest argument for a local vision backend: three isolated
judges per axis is the kind of redundancy you only buy when the judgements are
free.

## Packaging

```
<pets-dir>/<pet-id>/
├── pet.json           id, displayName, description, spriteVersionNumber: 2,
│                      spritesheetPath
└── spritesheet.webp   1536x2288
```

`~/.codex/pets/<id>/` installs it into Codex. petshop reads the same layout, so
a pet hatched here shows up in both — the body format is interchangeable for
the same reason the backends are.

## What was dropped from upstream, and why

- **`$imagegen` delegation, subagent prose, `load_workspace_dependencies`** —
  host-specific. Replaced by the two backend roles. The bundled-runtime
  requirement was not real: upstream's own tests pass on system Python 3.13
  with Pillow.
- **Storage controls** — about Codex rollout payloads, meaningless elsewhere.
- **Brand discovery worker** — a web-research step for "make me a pet for
  $COMPANY". Genuinely useful, entirely separable, and not part of hatching.
  If you want it, it is a research prompt, not a pipeline stage.
- **The 30-minute budget, checkpoints, and visible progress checklist** — a
  UI convention of the host. Keep the underlying discipline, which is the only
  line worth carrying over: *if the same root failure recurs twice, stop
  varying the prompt and change strategy.*

What was **not** dropped: the contract, the job graph, the look-direction
ordering, and the QA gates. Those are the hard-won part, and they were right.
