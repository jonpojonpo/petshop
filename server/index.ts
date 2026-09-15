import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ROOT, STATE, AGENTS, ensureDirs, expand } from "./paths.ts";
import {
  listPets,
  saveSheet,
  seedConductor,
  sheetToml,
  getPet,
} from "./sheets.ts";
import { scanBodies, getBodies, bodyFile, importBody } from "./bodies.ts";
import { receipts } from "./ledger.ts";
import { accountUsage } from "./usage.ts";
import { Conductor } from "./conductor.ts";
import { ChatManager } from "./chat.ts";
import {
  searchCommunity,
  previewCommunity,
  communityPoster,
  adoptCommunity,
  communityCollection,
  adoptCollection,
} from "./community.ts";
import {
  roster,
  rotate,
  eligible,
  refreshRoster,
  chatOnce,
  paidProfile,
  hasKey,
  FREE_DATA_NOTICE,
} from "./openrouter.ts";
import type { Event } from "./types.ts";

await ensureDirs();
await seedConductor();
const bodyScan = await scanBodies();
const conductor = new Conductor();
await conductor.init();
const chats = new ChatManager(conductor.gpu);
await chats.init();
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res
      .status(403)
      .json({ error: "Cross-site requests are not accepted." });
  if (!["127.0.0.1", "localhost", "["].includes(host || ""))
    return res
      .status(403)
      .json({ error: "Petshop accepts loopback requests only." });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return res
      .status(403)
      .json({ error: "Cross-origin requests are not accepted." });
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "4mb" }));
app.get("/api/catalog", async (_req, res) =>
  res.json({
    ...(await listPets()),
    bodies: getBodies(),
    bodyErrors: bodyScan.errors,
    root: ROOT,
    sheetsPath: AGENTS,
    gpu: conductor.gpu.snapshot(),
  }),
);
app.post("/api/import/refresh", async (_req, res) =>
  res.json({ ...(await scanBodies()), ...(await listPets()) }),
);
app.post("/api/import/sheet", async (req, res) => {
  const source = req.body.source;
  const text = req.body.text ?? (await fs.readFile(expand(source), "utf8"));
  res.json(await saveSheet(req.body.id, text, false));
});
app.post("/api/import/body", async (req, res) =>
  res.json(await importBody(req.body.source, req.body.id)),
);
app.get("/api/community", async (req, res) =>
  res.json(
    await searchCommunity(
      String(req.query.q || ""),
      Number(req.query.page) || 1,
    ),
  ),
);
app.get("/api/community/collections/:slug", async (req, res) =>
  res.json(await communityCollection(req.params.slug)),
);
app.post("/api/community/collections/:slug/adopt", async (req, res) =>
  res.json(await adoptCollection(req.params.slug)),
);
app.get("/api/community/:slug/preview", async (req, res) =>
  res.json(await previewCommunity(req.params.slug)),
);
app.get("/api/community/:slug/poster", async (req, res) =>
  res.type("image/webp").send(await communityPoster(req.params.slug)),
);
app.post("/api/community/:slug/adopt", async (req, res) =>
  res.json(await adoptCommunity(req.params.slug)),
);
app.get("/api/openrouter", (_req, res) => {
  const r = roster();
  res.json({
    version: r.version,
    capturedAt: r.capturedAt,
    note: r.note,
    keyConfigured: hasKey(),
    notice: FREE_DATA_NOTICE,
    models: r.models,
    coding: eligible("coding").length,
    chat: eligible("chat").length,
  });
});
app.post("/api/openrouter/rotate", (req, res) => {
  const purpose = req.body?.purpose === "chat" ? "chat" : "coding";
  const exclude = Array.isArray(req.body?.exclude)
    ? req.body.exclude.filter((x: any) => typeof x === "string")
    : [];
  res.json(
    rotate(
      purpose,
      getBodies().map((b) => b.id),
      exclude,
    ),
  );
});
app.post("/api/openrouter/refresh", async (_req, res) => {
  const r = await refreshRoster();
  res.json({ version: r.version, capturedAt: r.capturedAt, models: r.models });
});
app.post("/api/openrouter/chat", async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (
    !messages.length ||
    messages.some(
      (m: any) =>
        typeof m?.content !== "string" ||
        !["user", "assistant", "system"].includes(m?.role),
    )
  )
    throw new Error("A chat trial needs user and assistant messages.");
  if (JSON.stringify(messages).length > 60000)
    throw new Error("This chat trial is too long. Start a new one.");
  res.json(await chatOnce(String(req.body.modelId || ""), messages));
});
app.get("/api/openrouter/paid", async (req, res) =>
  res.json(await paidProfile(String(req.query.model || ""))),
);
app.post("/api/pets", async (req, res) =>
  res.json(
    await saveSheet(req.body.id, req.body.sheet, req.body.overwrite === true),
  ),
);
app.get("/api/pets/:id/export", async (req, res) =>
  res
    .type("application/toml")
    .attachment(`${req.params.id}.toml`)
    .send(sheetToml(await getPet(req.params.id))),
);
app.get("/api/bodies/:id/atlas", async (req, res) => {
  const file = bodyFile(req.params.id);
  if (!file) return res.status(404).end();
  // Catalogued atlases live in .codex and .petshop; sendFile otherwise hides them.
  res.sendFile(file, { dotfiles: "allow" });
});
app.get("/api/bodies/:id/portrait", async (req, res) => {
  const file = bodyFile(req.params.id);
  if (!file) return res.status(404).end();
  res
    .type("image/webp")
    .send(
      await sharp(file)
        .extract({ left: 0, top: 0, width: 192, height: 208 })
        .webp()
        .toBuffer(),
    );
});
app.get("/api/runs", (_req, res) =>
  res.json({
    runs: conductor.list(),
    gpu: conductor.gpu.snapshot(),
    pending: conductor.pending(),
  }),
);
app.get("/api/chats", (_req, res) => res.json({ chats: chats.list() }));
app.post("/api/chats", async (req, res) => res.status(201).json(await chats.create(req.body.petId)));
async function chatFiles(root: string, prefix = "", depth = 0): Promise<string[]> {
  const results: string[] = [];
  if (depth > 4) return results;
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
    const name = path.join(prefix, entry.name);
    if (entry.isFile()) results.push(name);
    else if (entry.isDirectory()) results.push(...await chatFiles(root, name, depth + 1));
    if (results.length >= 100) break;
  }
  return results.slice(0, 100);
}
app.get("/api/chats/:id", async (req, res) => {
  const chat = chats.get(req.params.id);
  const notes = await fs.readFile(path.join(STATE, "memories", `${chat.petId}.txt`), "utf8").catch(() => "");
  res.json({ chat, pending: chats.pending(chat.id), files: await chatFiles(chat.cwd), notes });
});
app.post("/api/chats/:id/messages", async (req, res) => res.json(await chats.send(req.params.id, req.body.text, req.body)));
app.post("/api/chats/:id/cancel", async (req, res) => { await chats.cancel(req.params.id); res.json({ ok: true }); });
app.post("/api/chat-decisions/:id", (req, res) => { chats.decide(req.params.id, req.body.option); res.json({ ok: true }); });
app.get("/api/chats/:id/file", async (req, res) => {
  const chat = chats.get(req.params.id);
  const relative = String(req.query.path || "");
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === ".." || p.startsWith(".")))
    return res.status(400).json({ error: "Invalid file path." });
  const root = await fs.realpath(chat.cwd);
  const file = await fs.realpath(path.join(root, relative));
  if (!file.startsWith(root + path.sep) || !(await fs.stat(file)).isFile())
    return res.status(403).json({ error: "File is outside this conversation." });
  res.attachment(path.basename(file)).sendFile(file, { dotfiles: "allow" });
});
app.post("/api/runs", async (req, res) => {
  const run = await conductor.start(req.body);
  res.status(201).json(run);
});
app.get("/api/runs/:id", (_req, res) => {
  const run = conductor.runs.get(_req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found." });
  res.json(run);
});
app.post("/api/runs/:id/cancel", async (req, res) => {
  await conductor.cancel(req.params.id);
  res.json({ ok: true });
});
app.post("/api/decisions/:id", async (req, res) => {
  conductor.decide(req.params.id, req.body.option);
  res.json({ ok: true });
});
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const event = (e: Event) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  conductor.on("event", event);
  const heartbeat = setInterval(() => res.write(": connected\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    conductor.off("event", event);
  });
});
app.get("/api/ledger", async (_req, res) =>
  res.json({ receipts: await receipts() }),
);
app.get("/api/usage", async (_req, res) => res.json(await accountUsage()));
app.post("/api/gpu/stop", async (_req, res) => {
  if (conductor.gpu.owner)
    return res
      .status(409)
      .json({ error: "Finish or cancel the active GPU quest first." });
  await conductor.gpu.stop();
  res.json(conductor.gpu.snapshot());
});
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, protocol: "ACP", state: STATE }),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown Petshop API route." }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(ROOT, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(ROOT, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.join(ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error.message);
    res
      .status(error.code === "EEXIST" ? 409 : 400)
      .json({ error: error.message || "Request failed." });
  },
);
const port = Number(process.env.PORT || 4321);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Petshop is open at http://127.0.0.1:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    void chats.shutdown().then(() => conductor.shutdown())
      .finally(() => {
        server.closeAllConnections();
        server.close(() => process.exit(0));
      });
  });
