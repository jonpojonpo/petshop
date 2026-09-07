#!/usr/bin/env python3
"""Interchangeable image and vision backends for hatching pets.

Hatching a pet is mostly deterministic image processing — `scripts/` is stdlib
plus Pillow and needs no model at all. Exactly two steps need one:

    image   generate a picture from a prompt plus reference images
    vision  look at a picture and answer a bounded question about it

That is the entire seam. Codex's version of this skill hard-wired both to
`$imagegen` and to its own subagents; here they are two roles in
`backends.toml`, and anything that can fill a role can hatch a pet.

The vision role is the interesting one. A pet run asks for roughly thirty small
visual judgements — is this frame's gaze up or down, does this loop reverse, is
this cell empty — and each is a bounded question with a short answer. That is
work a 12B model with a projector does on your own GPU, and it is where the
frontier tokens in a hatch run actually go.

Stdlib only, deliberately: this file is the adapter, and adapters stay thin.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import shlex
import subprocess
import sys
import tomllib
import urllib.error
import uuid
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG = Path(__file__).with_name("backends.toml")
ROLES = ("image", "vision")


class BackendError(RuntimeError):
    """A backend was unreachable, misconfigured, or answered unusably."""


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _post_json(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    body = json.dumps(payload).encode()
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise BackendError(f"{url} -> HTTP {exc.code}: {exc.read()[:400].decode(errors='replace')}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise BackendError(f"{url} unreachable: {exc}") from exc


def _post_multipart(url: str, fields: dict, files: list[tuple[str, Path]],
                    headers: dict, timeout: float) -> dict:
    """multipart/form-data by hand. It is thirty lines and it keeps this file
    dependency-free, which matters more here than elegance."""
    boundary = "----petshop" + uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for name, path in files:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            f'filename="{path.name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
        )
        parts.append(path.read_bytes())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise BackendError(f"{url} -> HTTP {exc.code}: {exc.read()[:400].decode(errors='replace')}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise BackendError(f"{url} unreachable: {exc}") from exc


@dataclass
class Backend:
    """One configured backend. `kind` decides how it is called, not who made it."""

    role: str
    name: str
    kind: str
    options: dict = field(default_factory=dict)

    # -- helpers ---------------------------------------------------------
    def _opt(self, key: str, default=None, required: bool = False):
        value = self.options.get(key, default)
        if required and value in (None, ""):
            raise BackendError(f"backend '{self.name}' needs `{key}` in backends.toml")
        return value

    def _headers(self) -> dict:
        headers = dict(self._opt("headers", {}))
        key = self._opt("api_key")
        if isinstance(key, str) and key.startswith("env:"):
            # Keys live in the environment, never in the config file.
            name = key[4:]
            key = os.environ.get(name)
            if not key:
                raise BackendError(f"backend '{self.name}' wants ${name}, which is unset")
        if key:
            headers.setdefault("Authorization", f"Bearer {key}")
        return headers

    # -- vision ----------------------------------------------------------
    def judge(self, question: str, images: list[Path], choices: list[str] | None = None) -> dict:
        """Answer a bounded question about images.

        With `choices`, the answer is constrained to that set and returned as
        `choice`; a backend that will not commit to one is an error, not a
        shrug. Blind direction QA is exactly this shape, which is why a small
        local model can do it.
        """
        if self.role != "vision":
            raise BackendError(f"backend '{self.name}' is not a vision backend")
        prompt = question
        if choices:
            prompt = (
                f"{question}\n\n"
                f"Answer with exactly one of: {', '.join(choices)}\n"
                "Reply with that answer alone. No explanation, no punctuation."
            )
        raw = self._vision_call(prompt, images).strip()
        result = {"raw": raw, "backend": self.name}
        if choices:
            result["choice"] = _match_choice(raw, choices)
        return result

    def _vision_call(self, prompt: str, images: list[Path]) -> str:
        if self.kind == "openai-chat":
            content: list[dict] = [{"type": "text", "text": prompt}]
            for image in images:
                content.append({"type": "image_url", "image_url": {"url": _data_uri(image)}})
            payload = {
                "model": self._opt("model", required=True),
                "messages": [{"role": "user", "content": content}],
                "max_tokens": self._opt("max_tokens", 512),
                "temperature": self._opt("temperature", 0),
            }
            # Provider-specific knobs (reasoning switches, sampler settings)
            # pass straight through rather than growing a compatibility table.
            payload.update(self._opt("extra_body", {}))
            data = _post_json(
                self._opt("base_url", required=True).rstrip("/") + "/chat/completions",
                payload,
                self._headers(),
                self._opt("timeout", 180),
            )
            try:
                choice = data["choices"][0]
                message = choice["message"]
            except (KeyError, IndexError) as exc:
                raise BackendError(f"backend '{self.name}' returned no message: {str(data)[:300]}") from exc
            text = message.get("content") or ""
            if not text.strip():
                # A local reasoning model will happily spend the whole token
                # budget thinking and return an empty answer. Silently treating
                # that as "no verdict" is how a QA gate quietly stops gating.
                if message.get("reasoning_content") or choice.get("finish_reason") == "length":
                    raise BackendError(
                        f"backend '{self.name}' spent its {payload['max_tokens']}-token budget "
                        "reasoning and returned an empty answer. Raise `max_tokens`, or turn "
                        "thinking off in `extra_body`."
                    )
                raise BackendError(f"backend '{self.name}' returned an empty answer")
            return text
        if self.kind == "cli":
            return self._run_cli(prompt, images)
        raise BackendError(f"backend '{self.name}' has unknown kind '{self.kind}'")

    # -- image -----------------------------------------------------------
    def generate(self, prompt: str, refs: list[Path], out: Path, n: int = 1) -> list[Path]:
        """Generate `n` candidates into `out`, newest-first. Returns real paths."""
        if self.role != "image":
            raise BackendError(f"backend '{self.name}' is not an image backend")
        out.mkdir(parents=True, exist_ok=True)
        if self.kind == "openai-image":
            return self._openai_image(prompt, refs, out, n)
        if self.kind == "cli":
            before = set(out.iterdir())
            self._run_cli(prompt, refs, out=out, n=n)
            written = sorted(set(out.iterdir()) - before, key=lambda p: p.stat().st_mtime)
            if not written:
                raise BackendError(f"backend '{self.name}' wrote no image into {out}")
            return written
        raise BackendError(f"backend '{self.name}' has unknown kind '{self.kind}'")

    def _openai_image(self, prompt: str, refs: list[Path], out: Path, n: int) -> list[Path]:
        """OpenAI's Images API splits by whether you supply reference images.

        `/images/generations` is prompt-only JSON; `/images/edits` takes the
        references and is multipart. Only the base pet job is prompt-only, so
        the edits path is the one that runs twelve times out of thirteen.
        """
        base = self._opt("base_url", required=True).rstrip("/")
        fields = {"model": self._opt("model", required=True), "prompt": prompt, "n": str(n)}
        for key in ("size", "quality", "background", "output_format"):
            if self._opt(key) is not None:
                fields[key] = str(self._opt(key))

        if refs:
            # Reference grounding is required for every row job. A backend that
            # silently drops references produces identity drift, so say so.
            if not self._opt("supports_references", False):
                raise BackendError(
                    f"backend '{self.name}' was given {len(refs)} reference image(s) but is not "
                    "configured with supports_references; row jobs must be grounded"
                )
            data = _post_multipart(
                f"{base}/images/edits", fields, [("image[]", ref) for ref in refs],
                self._headers(), self._opt("timeout", 600),
            )
        else:
            payload = dict(fields)
            payload["n"] = n
            data = _post_json(f"{base}/images/generations", payload,
                              self._headers(), self._opt("timeout", 600))

        written = []
        for index, item in enumerate(data.get("data", [])):
            if "b64_json" not in item:
                raise BackendError(f"backend '{self.name}' returned no b64_json (url-only responses unsupported)")
            suffix = self._opt("output_format", "png")
            path = out / f"candidate-{index}.{suffix}"
            path.write_bytes(base64.b64decode(item["b64_json"]))
            written.append(path)
        if not written:
            raise BackendError(f"backend '{self.name}' returned no images")
        return written

    # -- cli -------------------------------------------------------------
    def _run_cli(self, prompt: str, images: list[Path], out: Path | None = None, n: int = 1) -> str:
        """Shell out. This is how any harness — claude -p, codex exec, a local
        script — becomes a backend without this file knowing it exists."""
        template = self._opt("command", required=True)
        replacements = {
            "{prompt_file}": None,  # filled below when the template asks for it
            "{images}": " ".join(shlex.quote(str(p)) for p in images),
            "{out}": shlex.quote(str(out)) if out else "",
            "{n}": str(n),
        }
        prompt_file = None
        if "{prompt_file}" in template:
            prompt_file = (out or Path(".")) / ".prompt.txt"
            prompt_file.write_text(prompt)
            replacements["{prompt_file}"] = shlex.quote(str(prompt_file))
        command = template
        for token, value in replacements.items():
            if value is not None:
                command = command.replace(token, value)
        command = command.replace("{prompt}", shlex.quote(prompt))
        try:
            done = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=self._opt("timeout", 600), cwd=self._opt("cwd"),
            )
        except subprocess.TimeoutExpired as exc:
            raise BackendError(f"backend '{self.name}' timed out") from exc
        finally:
            if prompt_file and prompt_file.exists():
                prompt_file.unlink()
        if done.returncode != 0:
            raise BackendError(
                f"backend '{self.name}' exited {done.returncode}: {done.stderr.strip()[:400]}"
            )
        return done.stdout


def _match_choice(raw: str, choices: list[str]) -> str:
    """Pick the intended choice out of a small model's answer, or refuse.

    Small models add politeness and punctuation; they rarely pick two options.
    Accept the sloppiness, reject the ambiguity.
    """
    cleaned = raw.strip().strip(".!\"'` \n").lower()
    for choice in choices:
        if cleaned == choice.lower():
            return choice
    hits = [c for c in choices if c.lower() in cleaned]
    if len(hits) == 1:
        return hits[0]
    raise BackendError(f"ambiguous answer {raw!r}; expected one of {choices}")


@dataclass
class Registry:
    backends: dict[str, Backend]

    def __getitem__(self, role: str) -> Backend:
        if role not in self.backends:
            raise BackendError(
                f"no '{role}' backend selected. Set `{role} = \"<name>\"` under [use] in backends.toml"
            )
        return self.backends[role]

    @property
    def image(self) -> Backend:
        return self["image"]

    @property
    def vision(self) -> Backend:
        return self["vision"]


def load(config: Path | str = DEFAULT_CONFIG) -> Registry:
    path = Path(config)
    if not path.exists():
        raise BackendError(f"no backend config at {path}")
    data = tomllib.loads(path.read_text())
    selected = data.get("use", {})
    defined = data.get("backend", {})
    chosen: dict[str, Backend] = {}
    for role in ROLES:
        name = selected.get(role)
        if not name:
            continue
        if name not in defined:
            raise BackendError(f"[use] {role} = {name!r} but no [backend.{name}] is defined")
        options = dict(defined[name])
        kind = options.pop("kind", None)
        if not kind:
            raise BackendError(f"[backend.{name}] needs a `kind`")
        chosen[role] = Backend(role=role, name=name, kind=kind, options=options)
    return Registry(chosen)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", default=DEFAULT_CONFIG, type=Path)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("probe", help="check that the selected backends answer")

    judge = sub.add_parser("judge", help="ask the vision backend a bounded question")
    judge.add_argument("--image", action="append", type=Path, required=True)
    judge.add_argument("--question", required=True)
    judge.add_argument("--choices", help="comma-separated; constrains the answer")

    gen = sub.add_parser("generate", help="ask the image backend for candidates")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--ref", action="append", type=Path, default=[])
    gen.add_argument("--out", type=Path, required=True)
    gen.add_argument("-n", type=int, default=1)

    args = parser.parse_args()
    try:
        registry = load(args.config)
        if args.command == "probe":
            return _probe(registry)
        if args.command == "judge":
            choices = args.choices.split(",") if args.choices else None
            print(json.dumps(registry.vision.judge(args.question, args.image, choices), indent=2))
        if args.command == "generate":
            for path in registry.image.generate(args.prompt, args.ref, args.out, args.n):
                print(path)
    except BackendError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def _probe(registry: Registry) -> int:
    failed = False
    for role in ROLES:
        try:
            backend = registry[role]
        except BackendError as exc:
            print(f"  {role:6} - not selected ({exc})")
            continue
        print(f"  {role:6} {backend.name} ({backend.kind})", end=" ... ", flush=True)
        try:
            if role == "vision":
                backend.judge("Reply with the single word: ok", [], choices=["ok"])
            else:
                backend._opt("model", required=backend.kind == "openai-image")
                backend._opt("command", required=backend.kind == "cli")
            print("ok")
        except BackendError as exc:
            failed = True
            print(f"FAILED\n         {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
