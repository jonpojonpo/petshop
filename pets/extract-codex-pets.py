#!/usr/bin/env python3
"""Extract every pet Codex currently knows about into one inventory.

Three sources, because Codex keeps "pet" in three places:

  agents/*.toml   - agent pets: a model, a leash, a temperament. The stat block.
  pets/*/pet.json - sprite pets: hatched locally by the hatch-pet skill. The body.
  app.asar        - the nine companions that ship with the desktop app. Bodies only.

Re-run it after hatching; it is a snapshot, not a fixture.
"""

import json
import os
import re
import sys
from pathlib import Path

CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
ASAR = Path("/usr/lib/chatgpt/resources/app.asar")

# assetRef:`x`,description:`y`,displayName:`z`,id:`w`,spriteVersionNumber:n
BUILTIN = re.compile(
    rb"assetRef:`(?P<ref>[^`]*)`,description:`(?P<desc>[^`]*)`,"
    rb"displayName:`(?P<name>[^`]*)`,id:`(?P<id>[^`]*)`,"
    rb"spriteVersionNumber:(?P<ver>\d+)"
)
ASSET = re.compile(rb"(?P<ref>[a-z-]+)-spritesheet-v(?P<rev>\d+)-[0-9a-f]+\.webp")


def toml_pets(d):
    """Agent pets. Deliberately dumb: these files are flat key = value TOML."""
    out = []
    for f in sorted(d.glob("*.toml")):
        raw = f.read_text()
        pet = {"kind": "agent", "source": str(f)}
        for key in ("name", "description", "model", "model_provider",
                    "model_reasoning_effort", "sandbox_mode"):
            m = re.search(rf'^{key} = "(.*)"$', raw, re.M)
            if m:
                pet[key] = m.group(1)
        m = re.search(r"^model_context_window = (\d+)$", raw, re.M)
        if m:
            pet["model_context_window"] = int(m.group(1))
        m = re.search(r'^developer_instructions = """(.*?)"""', raw, re.M | re.S)
        if m:
            pet["developer_instructions"] = m.group(1).strip()
        out.append(pet)
    return out


def sprite_pets(d):
    out = []
    for manifest in sorted(d.glob("*/pet.json")):
        pet = json.loads(manifest.read_text())
        pet["kind"] = "sprite"
        pet["origin"] = "hatched"
        pet["source"] = str(manifest)
        sheet = manifest.parent / pet.get("spritesheetPath", "spritesheet.webp")
        pet["spritesheet"] = str(sheet) if sheet.exists() else None
        out.append(pet)
    return out


def builtin_pets(asar):
    """The desktop app's own companions, read straight out of the bundle."""
    if not asar.exists():
        return []
    blob = asar.read_bytes()
    revs = {m["ref"].decode(): int(m["rev"]) for m in ASSET.finditer(blob)}
    seen, out = set(), []
    for m in BUILTIN.finditer(blob):
        pid = m["id"].decode()
        if pid in seen:
            continue
        seen.add(pid)
        ref = m["ref"].decode()
        out.append({
            "kind": "sprite",
            "origin": "bundled",
            "id": pid,
            "displayName": m["name"].decode(),
            "description": m["desc"].decode(),
            "spriteVersionNumber": int(m["ver"]),
            "assetRef": ref,
            "assetRevision": revs.get(ref),
            "source": str(asar),
        })
    return sorted(out, key=lambda p: p["id"])


def main():
    pets = (toml_pets(CODEX_HOME / "agents")
            + sprite_pets(CODEX_HOME / "pets")
            + builtin_pets(ASAR))
    doc = {
        "codex_home": str(CODEX_HOME),
        "counts": {
            "agent": sum(p["kind"] == "agent" for p in pets),
            "sprite_hatched": sum(p.get("origin") == "hatched" for p in pets),
            "sprite_bundled": sum(p.get("origin") == "bundled" for p in pets),
            "total": len(pets),
        },
        "sprite_contract": {
            "spriteVersionNumber": 2,
            "atlas": [1536, 2288],
            "grid": [8, 11],
            "cell": [192, 208],
            "rows": ["idle", "running-right", "running-left", "waving", "jumping",
                     "failed", "waiting", "running", "review",
                     "look-000-157.5", "look-180-337.5"],
        },
        "pets": pets,
    }
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("codex-pets.json")
    out.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"{doc['counts']['total']} pets -> {out}")
    for p in pets:
        print(f"  {p['kind']:6} {p.get('origin', 'toml'):8} {p.get('id') or p.get('name')}")


if __name__ == "__main__":
    main()
