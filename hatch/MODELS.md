# Which model should generate the pets

Research, September 2026. The vision half of hatching is settled and local — a
12B model with a projector judges look-directions at 0.10 s each (`README.md`).
This is about the other half: the 13 image jobs.

## The verdict

**Default is `gpt-image-2`, hosted. Local generation is the aspiration, not the
plan.** Identity across thirteen separate calls is the requirement that decides
this, and it is the one thing hosted models are currently much better at. The
default costs money and is worth it until a local model is *shown* to hold a
pet together, which nothing here has been.

Also viable and deliberately not built: **Nano Banana / Nano Banana Pro**,
Google's image models, which the ComfyUI sprite-sheet templates use. Hosted, so
it competes with the default rather than with the local aspiration — worth
revisiting only if `gpt-image-2` disappoints on identity.

**Billing has two routes, and they are not the same product.** An API key
(`OPENAI_API_KEY`, set in this shell) hits `gpt-image-2` directly and gives full
control of size and parameters. A ChatGPT subscription reaches image generation
only through the built-in `image_gen__imagegen` tool inside the Codex agent
runtime — there is no endpoint and no token for it — so using it means running
Codex. `hatch/codex-imagegen.sh` does exactly that and is verified working: one
image in 51 s. The cost is control; the built-in tool chose its own 1254x1254
output and ignored the size we wanted.

The rest of this document is the research behind that, and behind what to try
first when local becomes worth another look.

## What the pipeline actually demands

Generic "best local image model" rankings answer the wrong question. `HATCH.md`
demands seven specific things, and they knock out most of the field:

1. **Identity across 13 separate generations.** Not consistency within one
   image — consistency between the base pet and twelve later calls made minutes
   apart. This is the requirement that decides everything.
2. **Reference conditioning is mandatory.** Every job but the base attaches the
   canonical base image. A text-to-image model cannot do jobs 2-13 at all.
3. **Flat chroma background** (`#FF00FF` by default) with crisp edges, because
   the deterministic despill pass is what produces the alpha.
4. **Multiple poses per job** — 4 to 8 frames — or per-frame generation.
5. **Gaze direction, not camera orbit.** See the trap below.
6. **Readable at 192x208** after downscaling to a cell.
7. **Thirteen jobs plus repairs**, on one GPU that also has a conductor on it.

## The machine

24 GB VRAM, one inference sequence at a time, and — checked, not assumed —
**31 GB of free disk on a 97%-full drive**. That last number is a real
constraint: it disqualifies a comfortable two-model setup today.

ComfyUI here is 0.31.0 (2026-08-09) with DreamShaper 8, an SD1.5 checkpoint.
DreamShaper will not hold a character across nine animation rows; treat the
current local image setup as unusable for this and plan a download.

## The field

| model | disk | VRAM | licence | refs | speed |
|---|---|---|---|---|---|
| **Qwen-Image-Edit-2511** (20B) | ~20.5 GB FP8 | 20.5 GB FP8, 21.8 GB Q8 | **Apache 2.0** | 3 | ~5 min @ 40 steps; ~1 min @ 4-step Lightning |
| **FLUX.2 klein 4B** | ~8.4 GB | 8.4 GB distilled | **Apache 2.0** | multi | ~1.2 s @ 4 steps |
| **FLUX.2 klein 9B** | ~19.6 GB | 19.6 GB distilled | non-commercial | multi | ~2 s @ 4 steps |
| **FLUX.2 [dev]** | ~19 GB Q4_K_S | 19 GB + encoder on CPU | non-commercial | up to 10 | slow on 24 GB |
| **Z-Image Turbo** (6B) | ~16 GB BF16, ~8 FP8 | 6-16 GB | **Apache 2.0** | text-to-image | ~2.3 s @ 8 steps |
| DreamShaper 8 (installed) | 2 GB | ~8 GB | — | via IP-Adapter | fast, and not good enough |
| **gpt-image-2** *(the default)* | — | — | hosted | 4 | hosted |
| Nano Banana / Pro *(not built)* | — | — | hosted | multi | hosted |

Speeds are the published figures, mostly measured on a 5090; expect a 4090 to
be slower. Nothing in this table has been run here.

## The local aspiration, when it is time

**Base pet: Z-Image Turbo. The other twelve jobs: Qwen-Image-Edit-2511 with a
Lightning LoRA.**

The split follows from requirement 2. Job 1 is the only prompt-only job and the
only one where identity does not need preserving — it *defines* the identity —
so it wants a fast, good text-to-image model. Jobs 2-13 are all reference-
grounded edits of that base, which is a different model class.

Qwen-Image-Edit-2511 wins the edit half on three counts that matter more than
its benchmark position:

- **Apache 2.0.** FLUX.2 klein 9B and FLUX.2 dev are non-commercial. For a
  project whose stated wedge is not paying for tokens, a non-commercial image
  model is a poor foundation, and the 9B is otherwise the obvious pick.
- **Multi-image identity preservation** is what 2511 was specifically upgraded
  for, and identity across thirteen calls is requirement 1.
- **It fits.** FP8 at 20.5 GB clears 24 GB, and 40 steps at ~5 minutes per job
  is 65 minutes of pure generation, so the Lightning LoRA at 4-8 steps is not
  optional — it takes a job to roughly a minute at some cost in fine detail,
  which matters little at 192x208.

Worth noting as corroboration: the Limbicnation pixel-art-character dataset
independently arrived at the same shape — Z-Image-Turbo for the initial sprite,
then Qwen-Image-Edit-2511 to refine.

**If the disk stays full**, use **FLUX.2 klein 4B** for both roles instead. At
8.4 GB it is the only credible option that fits alongside anything else, it is
Apache 2.0, it does text-to-image *and* multi-reference editing in one model,
and there is already a pixel-art sprite LoRA trained on it for transparent-
background game assets. It will lose to Qwen on identity preservation. It is
the right first thing to try anyway, because it costs 8 GB to find out.

## Three things about the hosted default that change the pipeline

Checked against the API reference, not remembered:

- **Reference images go to a different endpoint.** `/images/generations` is
  prompt-only JSON; `/images/edits` takes the references and is
  multipart/form-data. Only the base pet is prompt-only, so the edits path runs
  twelve times out of thirteen. `backends.py` picks the endpoint by whether
  references were passed; this was wrong when first written and is now tested
  against both paths.
- **There is a minimum image size, and a row strip is below it.** Sizes need
  edges that are multiples of 16 and a total between 655,360 and 8,294,400
  pixels. A 6-frame strip at its native 1152x208 is 239k pixels — too small to
  ask for. So either request a large wide canvas (the config uses 2048x1152)
  and let extraction find the frames, or generate one cell at a time at
  1024x1024. This is a second, independent argument for per-frame generation.
- **It cannot return real transparency.** `gpt-image-2` does not support
  `background=transparent`; Codex's own bundled imagegen skill says so directly
  and routes true-transparency requests to `gpt-image-1.5` instead. So the
  chroma-key round trip is not a legacy habit to be optimised away — for the
  default model it is the only route to alpha, and the despill pass earns its
  place. (`Qwen-Image-Layered` below remains the interesting local exception.)
- **Generated chroma is never exact, and that is fine.** A test sprite asked for
  flat `#FF00FF` came back with **zero** pixels at that value; the modal
  background was `(245, 3, 247)`, 13.2 away in RGB, faintly gradiented. This is
  what the chroma threshold and the despill pass exist for. Any plan that
  assumes a clean key straight out of the model is wrong.

## The trap: Multiple-Angles is the wrong tool for look directions

The obvious move for rows 9-10 is Qwen's **Multiple-Angles LoRA** — it
advertises a 96-pose camera system, 8 horizontal angles x 4 vertical x 3
distances, and "character turnarounds" from one reference. Eight horizontal
angles, eight cells per look row. It looks like a perfect fit.

It is not. That LoRA **rotates the camera around the subject**; its prompt
format is `<sks> [azimuth] [elevation] [distance]`, and azimuth runs
front / front-right / right side / back-right / back — it will show you the
pet's back. The v2 look rows are **gaze**: the pet faces the viewer and moves
its eyes and head while the camera stays put. Upstream states the rule
directly — look rows that rotate or tilt the whole sprite to fake gaze are a
failure unless the pet is literally a rotating object.

So the LoRA would produce a plausible-looking turnaround that fails the gate,
and it would fail it in the expensive way: after generation, at blind QA. Use
it for a character turnaround reference if you like. Do not point it at rows
9-10.

## Generate per frame, not as a wide strip

`HATCH.md` describes rows as horizontal strips of 4-8 frames, which for a
6-frame row is a 1152x208 image — a 5.5:1 aspect ratio holding six separately
posed, evenly spaced, non-overlapping copies of one character. That is a hard
ask for any diffusion model and a harder one for a 4B.

It is also not required. `compose_atlas.py --frames-root` accepts a directory
of individual cells (`<state>/` subdirectories, or `state_*` / `row-N-*`
filenames) — verified here — so a backend that generates one frame per call can
skip `extract_strip_frames.py` entirely and hand finished cells to the same
composer.

For an *edit* model this is the natural shape anyway: "the pet in the reference,
mid-blink" is one instruction on one image, which is exactly what
Qwen-Image-Edit and klein are built for. It costs more calls and buys much
better odds on identity. Start there; try strips only if per-frame proves
slower than it is worth.

## Considered and rejected

- **Sprite Sheet Diffusion** (MIT, weights published) is the only model in this
  search purpose-built for animation frames. It is pose-guided, built on
  Animate Anyone, and assumes a human skeleton. Pets here include a plush
  fox-owl and a blue-screen gremlin. Wrong shape.
- **Qwen-Image-Layered** decomposes images into true RGBA layers and would in
  principle remove the chroma-key and despill machinery altogether. Tempting,
  and worth a look later, but the vendored QA gates are built around chroma and
  the despill report — changing that means changing the acceptance criteria, not
  just the backend.
- **SDXL + IP-Adapter** is the cheap option and has the deepest LoRA ecosystem,
  but character identity across thirteen calls is precisely where it is weakest.

## What has not been tested

Every local option here. These are published figures and licence terms, not
measurements taken here, and none of the three requirements that actually decide the outcome
— identity across thirteen calls, flat chroma edges clean enough for the
despill pass, readability at 192x208 — can be settled from a spec sheet.

The cheap experiment is FLUX.2 klein 4B: 8.4 GB, generate a base pet and one
6-frame idle row per frame, run them through `extract_strip_frames.py` and
`inspect_frames.py`, and read the component and clipping report. That is one
download and about an hour, and it answers requirement 3 and 4 for real.
