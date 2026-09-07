# hatch — pet bodies, without Codex

The body half of pet creation, extracted from Codex's `hatch-pet` skill and cut
loose from it. The sheet half lives in `../pets/`.

Codex can already hatch a pet, and hatches a good one. It can only do it inside
Codex, with `$imagegen`, using Codex's subagents as the eyes. This directory
keeps the pipeline and replaces the parts that were bolted to the host.

## What was actually coupled

Less than it looked. The 4,200 lines of Python under `scripts/` import stdlib
and Pillow and nothing else — no Codex API, no network, no model. All 28
upstream tests pass on system Python 3.13. The skill's own instruction to use a
bundled runtime via `load_workspace_dependencies` was not a real dependency.

The coupling was in the prose: 923 lines of SKILL.md that named `$imagegen` as
the only legal generator and Codex subagents as the only legal reviewers.

So the extraction is small:

| | upstream | here |
|---|---|---|
| deterministic pipeline | `scripts/` | vendored verbatim (`vendor.sh`) |
| contract docs | `references/` | vendored verbatim |
| tests | 28 passing | 28 passing |
| orchestration prose | `SKILL.md`, 923 lines | `HATCH.md`, 191 lines |
| image generation | `$imagegen`, hard-wired | `[use] image` in `backends.toml` |
| visual QA | Codex subagents | `[use] vision` in `backends.toml` |

`vendor.sh` re-pulls upstream and re-applies the one mechanical patch (host
branding out of prompts, `generation_skill: "$imagegen"` becomes the role name
`"image"`). Upstream fixes merge with a re-run and a diff. See `NOTICE`.

## The two holes

Hatching needs a model for exactly two things:

- **image** — 13 jobs: one base pet, nine animation rows, one cardinal anchor
  strip, two look rows.
- **vision** — roughly 30 bounded judgements: is this gaze up or down, does this
  loop reverse, is this cell empty, did the pet's identity drift.

Everything else is deterministic. Point either role at anything that can fill
it — a hosted API, a local server, or a shell command wrapping an agent CLI —
and the same pipeline runs.

That last option is not hypothetical. OpenAI's subscription image path is a
built-in tool inside the Codex agent runtime, with no endpoint and no token, so
the only way to bill a ChatGPT subscription instead of an API key is to run the
agent. `codex-imagegen.sh` does that through the `cli` backend kind, and it
works — one image, 51 s, no API key touched.

## The local vision model is the point

The vision role is ~30 short questions with short answers, and it is where a
hatch run's frontier tokens go. That work belongs on your own GPU.

Measured here, gemma-4-12B-it (Q4, with its projector) under
`llama.cpp/llama-server` on a 4090, judging real cardinal look-cells cropped
from the two pets already in `~/.codex/pets`:

```
  chika/up     expect up    -> rejected: answered "front"   0.15s
  chika/right  expect right -> right                        0.09s
  chika/down   expect down  -> down                         0.10s
  chika/left   expect left  -> left                         0.10s
  juno-right   expect right -> right                        0.10s
  juno-left    expect left  -> left                         0.10s
  juno-down    expect down  -> down                         0.11s

  6/7 correct, median 0.10s per judgement, ~10 GB VRAM
```

Thirty judgements is about three seconds. Three isolated blind judges per axis —
which the QA gate wants and which nobody pays frontier rates for — is nine.

Two things that result is honest about:

- **`up` is the hard cardinal.** The model answered "front" for chika's `000`
  cell, and having looked at the cell, that is a defensible read: it is a weak
  "up". The gate caught it as ambiguous rather than accepting a wrong verdict,
  which is the behaviour you want. It is also exactly why upstream splits
  horizontal from vertical and requires a majority of three.
- **Reasoning models return nothing if you budget for the answer.** With
  thinking on, the same model spent a 1536-token budget deliberating about
  gaze and returned an empty string. `backends.py` raises on that rather than
  recording "no verdict"; a QA gate that silently stops gating is worse than
  one that fails. The shipped config turns thinking off for classification.

Image generation is the half that stays hard locally, so it stays hosted:
`gpt-image-2` is the default and local generation is an aspiration with nothing
downloaded behind it yet. `MODELS.md` is the research — what the pipeline
actually demands, which local models clear the bar, why the obvious LoRA for
look directions is a trap, why a row strip is too small to ask the API for, and
what 31 GB of free disk rules out. Hosted image plus local vision is not a
compromise: the vision half is where the tokens were.

## Use

```bash
python3 smoke.py              # hatch a pet from synthetic strips, no model at all
python3 backends.py probe     # are the configured backends reachable
python3 -m pytest tests -q    # upstream's 28 tests
```

`smoke.py` runs the whole deterministic chain — prepare, extract, inspect,
compose, assemble v2, despill, validate — and asserts a `1536x2288` v2 atlas
comes out. It is the check that the extraction still holds after re-vendoring.

Then read `HATCH.md`, which is the actual procedure.

## Status

Verified: the deterministic pipeline end to end with no model; the backend seam
through both an image and a vision backend; the local vision backend against
real pet cells, with numbers above.

Not yet done: a full hatch with a real image backend. That needs an image API
key and about thirty minutes of generation, and it is the obvious next step.
