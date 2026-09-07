#!/usr/bin/env python3
"""Hatch a pet with no model at all, and check the atlas that comes out.

Every model-shaped step is replaced with flat synthetic strips, which leaves
exactly the deterministic pipeline under test: extract, inspect, compose,
assemble v2, despill, validate. If this passes, the vendored core works outside
Codex on a plain Python with Pillow — which is the whole claim this directory
makes. Run it after `vendor.sh`.

    python3 smoke.py [--keep]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HATCH = Path(__file__).resolve().parent
SCRIPTS = HATCH / "scripts"
CHROMA = "#FF00FF"
ROWS = {
    "idle": 6, "running-right": 8, "running-left": 8, "waving": 4, "jumping": 5,
    "failed": 8, "waiting": 6, "running": 6, "review": 6,
    "look-cardinals": 4, "look-row-9": 8, "look-row-10": 8,
}


def run(script: str, *args: str) -> dict:
    done = subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        raise SystemExit(f"{script} failed:\n{done.stderr.strip()}")
    try:
        return json.loads(done.stdout)
    except json.JSONDecodeError:
        return {}


def synthetic_strip(frames: int, seed: int) -> Image.Image:
    """A blob that moves a little between frames. Enough to survive component
    extraction and frame-difference checks; not a pet."""
    image = Image.new("RGBA", (192 * frames, 208), (255, 0, 255, 255))
    draw = ImageDraw.Draw(image)
    for index in range(frames):
        cx, cy = 192 * index + 96, 104 + (index % 3) - 1
        draw.ellipse([cx - 52, cy - 56, cx + 52, cy + 56], fill=(60 + seed * 13 % 150, 120, 200, 255))
        draw.ellipse([cx - 24, cy - 20, cx - 8, cy - 4], fill=(255, 255, 255, 255))
        draw.ellipse([cx + 8, cy - 20, cx + 24, cy - 4], fill=(255, 255, 255, 255))
        draw.rectangle([cx - 30 + index * 2, cy + 34, cx + 30 + index * 2, cy + 50], fill=(240, 200, 60, 255))
    return image


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--keep", action="store_true", help="leave the run folder in place")
    args = parser.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="hatch-smoke-"))
    run_dir = workdir / "run"
    try:
        run("prepare_pet_run.py", "--pet-name", "Smoke", "--description",
            "A synthetic pet used to test the pipeline.", "--output-dir", str(run_dir))

        jobs = json.loads((run_dir / "imagegen-jobs.json").read_text())
        jobs = jobs["jobs"] if isinstance(jobs, dict) else jobs
        roles = {job.get("generation_skill") for job in jobs}
        assert roles == {"image"}, f"manifest still names a host skill: {roles}"
        assert len(jobs) == 13, f"expected 13 visual jobs, got {len(jobs)}"

        decoded = run_dir / "decoded"
        decoded.mkdir(exist_ok=True)
        for name, frames in ROWS.items():
            synthetic_strip(frames, len(name)).save(decoded / f"{name}.png")
        synthetic_strip(1, 3).save(decoded / "base.png")

        run("extract_strip_frames.py", "--decoded-dir", str(decoded),
            "--output-dir", str(run_dir / "frames"), "--states", "all", "--method", "auto")

        review = run("inspect_frames.py", "--frames-root", str(run_dir / "frames"),
                     "--json-out", str(run_dir / "qa/review.json"), "--require-components")
        assert not review.get("errors"), f"frame inspection errors: {review['errors']}"

        final = run_dir / "final"
        final.mkdir(exist_ok=True)
        run("compose_atlas.py", "--frames-root", str(run_dir / "frames"),
            "--output", str(final / "standard.png"))
        run("assemble_extended_atlas.py", "--base-atlas", str(final / "standard.png"),
            "--look-row-9", str(decoded / "look-row-9.png"),
            "--look-row-10", str(decoded / "look-row-10.png"),
            "--chroma-key", CHROMA, "--output", str(final / "spritesheet.png"),
            "--webp-output", str(final / "spritesheet.webp"))

        despill = run("despill_chroma_edges.py", str(final / "spritesheet.png"),
                      "--chroma-key", CHROMA, "--output", str(final / "spritesheet.png"),
                      "--webp-output", str(final / "spritesheet.webp"),
                      "--json-out", str(run_dir / "qa/despill.json"))
        assert despill.get("ok"), f"despill not ok: {despill}"
        assert despill.get("alpha_preserved"), "despill altered alpha"

        atlas = run("validate_atlas.py", str(final / "spritesheet.webp"),
                    "--require-v2", "--chroma-key", CHROMA)
        assert atlas["errors"] == [], f"atlas errors: {atlas['errors']}"
        assert (atlas["width"], atlas["height"]) == (1536, 2288), "wrong atlas size"
        assert atlas["sprite_version_number"] == 2, "not a v2 atlas"

        print(f"ok  13 jobs, {atlas['columns']}x{atlas['rows']} atlas, "
              f"{atlas['width']}x{atlas['height']}, v{atlas['sprite_version_number']}, "
              f"{len(review.get('warnings', []))} warnings")
        if args.keep:
            print(f"    run kept at {run_dir}")
        return 0
    finally:
        if not args.keep:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
