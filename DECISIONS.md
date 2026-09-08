# Implementation decisions — JP, 7 September 2026

These interview decisions supersede the corresponding first-draft VISION clauses.

- Favor light leashes. Sandboxing is optional; YOLO is a deliberate selectable mode.
- Strong local and community imports are the first release. New hatching is deferred.
- `qwen_local` is an example, not a mandatory conductor identity. Preserve it and
  create an editable conductor variant. Harness, provider, and access are controls.
- Keep the current HauhauCS uncensored Qwen model and FastMTP tuning unchanged.
- Petshop manages its model processes and serializes GPU inference.
- A human approves advisor consultations. Sol/Opus through subscriptions are
  acceptable; metered API launches require explicit approval and never happen as
  an automatic authentication fallback.
- Drop speculative savings. Record tokens, reported real costs, subscription
  windows, weekly usage, and resets. Missing provider telemetry stays unknown.
- Pets should improve Petshop through bounded worktrees and commits. Publish the
  working code to GitHub; keep local credentials, bodies, telemetry, and worktrees
  out of the repository.
- Animate imported companions from real run state and show their progress and
  tool use. Handoffs carry evidence between pets; the shop remains a view over
  sheets, events, and receipts.

ACP is a session/control protocol, not a universal tool interception sandbox.
Borrow upstream adapters and apply native harness access settings. Commit bounds
are independently checked without claiming that they enforce OS isolation.
