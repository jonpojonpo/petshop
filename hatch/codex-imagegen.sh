#!/usr/bin/env bash
# Image backend that bills a ChatGPT subscription instead of an API key.
#
# OpenAI's subscription image path is a built-in tool inside the Codex agent
# runtime (`image_gen__imagegen`), not an HTTP endpoint — there is no token you
# can put in a header. So the only way to reach it is to run the agent, which is
# what this does. Codex's own imagegen skill says as much: the built-in tool
# "does not require OPENAI_API_KEY", and its CLI fallback does.
#
# Slower and less predictable than calling the API directly, because a whole
# agent turn sits between the prompt and the picture. Worth it if the
# subscription is already paid for.
#
# Usage (see [backend.codex-imagegen] in backends.toml):
#   codex-imagegen.sh <prompt-file> <out-dir> <n> [ref.png ...]
set -euo pipefail

PROMPT_FILE="$1"; OUT_DIR="$2"; N="${3:-1}"; shift 3 || true
REFS=("$@")

mkdir -p "$OUT_DIR"
before=$(find "$OUT_DIR" -maxdepth 1 -type f | sort)

ref_line=""
if [ ${#REFS[@]} -gt 0 ]; then
  ref_line="Use these images as visual references, they are authoritative for identity: ${REFS[*]}"
fi

# One turn, one job. The agent is told to write files and say nothing, because
# the caller wants images on disk, not a report.
codex exec --skip-git-repo-check --cd "$OUT_DIR" - <<EOF
Generate ${N} image(s) with your built-in image_gen tool.

${ref_line}

Save each result into ${OUT_DIR} as candidate-0.png, candidate-1.png, and so on.
Do not resize, crop, or post-process. Do not write any other file.
Reply with only the word done.

The image specification follows.

$(cat "$PROMPT_FILE")
EOF

after=$(find "$OUT_DIR" -maxdepth 1 -type f | sort)
new=$(comm -13 <(echo "$before") <(echo "$after") || true)
if [ -z "$new" ]; then
  echo "codex-imagegen: no image written into $OUT_DIR" >&2
  exit 1
fi
