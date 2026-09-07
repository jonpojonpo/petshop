#!/usr/bin/env bash
# Re-vendor the deterministic half of Codex's hatch-pet skill into petshop.
#
# Upstream is Apache-2.0, stdlib + Pillow only, and has no Codex API coupling:
# the scripts are pure image processing. Everything Codex-specific lives in the
# skill's prose, which we do not vendor — HATCH.md replaces it.
#
# Re-run after upstream changes. Review `git diff hatch/scripts` afterwards.
set -euo pipefail

SRC="${1:-${CODEX_HOME:-$HOME/.codex}/skills/hatch-pet}"
DST="$(cd "$(dirname "$0")" && pwd)"

[ -d "$SRC/scripts" ] || { echo "no hatch-pet skill at $SRC" >&2; exit 1; }

rm -rf "$DST/scripts" "$DST/references" "$DST/tests"
cp -r "$SRC/scripts" "$SRC/references" "$SRC/tests" "$DST/"
cp "$SRC/LICENSE.txt" "$DST/LICENSE"
rm -rf "$DST/scripts/__pycache__" "$DST/tests/__pycache__"

# The only patch we apply: strip the host's branding from generated prompts and
# make the job manifest name a backend *role* instead of a Codex skill.
# Everything else is verbatim so upstream fixes merge cleanly.
python3 - "$DST" <<'PYEOF'
import pathlib, re, sys
dst = pathlib.Path(sys.argv[1])
subs = [
    (r"Codex v2 pet",  "v2 pet"),
    (r"Codex pet",     "pet"),
    (r"Codex atlas",   "atlas"),
    (r"Show that Codex needs approval", "Show that the agent needs approval"),
    (r'"\$imagegen"',  '"image"'),
]
# Upstream's prose test points at SKILL.md; ours is HATCH.md and must keep the
# same invariant (exactly one despill pass, after v2 assembly).
for path in sorted(dst.glob("tests/*.py")):
    text = path.read_text()
    if "SKILL.md" in text:
        path.write_text(text.replace('"SKILL.md"', '"HATCH.md"'))
        print(f"  patched {path.relative_to(dst)}")

for path in sorted(dst.glob("scripts/*.py")) + sorted(dst.glob("references/*.md")):
    text = original = path.read_text()
    for pattern, replacement in subs:
        text = re.sub(pattern, replacement, text)
    if text != original:
        path.write_text(text)
        print(f"  patched {path.relative_to(dst)}")
PYEOF

echo "vendored from $SRC"
