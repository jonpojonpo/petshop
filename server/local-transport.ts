import http from "node:http";
import { StringDecoder } from "node:string_decoder";
import { Readable, Transform } from "node:stream";

export function normalizeResponses(body: any) {
  if (!Array.isArray(body.input)) return body;
  const instructions = [body.instructions].filter(
    (s): s is string => typeof s === "string" && !!s,
  );
  const input = body.input.map((item: any) => item.type === "function_call" && item.namespace ? { ...item, name: `${item.namespace}__${item.name}`, namespace: undefined } : item).filter((item: any) => {
    if (!["system", "developer"].includes(item.role)) return true;
    const text =
      typeof item.content === "string"
        ? item.content
        : (item.content || []).map((c: any) => c.text || "").join("\n");
    if (text) instructions.push(text);
    return false;
  });
  // llama.cpp accepts flat function tools, whereas current Codex groups MCP
  // functions into Responses namespaces. Keep Codex's qualified MCP names.
  const tools = body.tools?.flatMap((tool: any) => tool.type === "namespace"
    ? tool.tools.map((fn: any) => ({ ...fn, name: `${tool.name}__${fn.name}` })) : [tool]);
  return { ...body, input, ...(tools ? {tools} : {}), instructions: instructions.join("\n\n") };
}
/** Pure wire compatibility: Qwen's template accepts system text only at the start.
 * The model server and Codex still own generation and tool iteration.
 *
 * `headers` are injected on the way upstream and never handed to the harness, so
 * a remote credential stays inside the Petshop process: it reaches no config
 * file, no child environment, no sheet and no receipt. */
export async function localTransport(
  endpoint: string,
  headers: Record<string, string> = {},
) {
  const sockets = new Set<any>();
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024)
          throw new Error("Local model request is too large.");
        chunks.push(chunk);
      }
      let body = Buffer.concat(chunks).toString("utf8");
      const pathname = (req.url || "/").replace(/^\/v1/, "");
      const namespaces = new Map<string, {name: string; namespace: string}>();
      if (pathname === "/responses" && body) for (const group of JSON.parse(body).tools || []) if (group.type === "namespace") for (const fn of group.tools) namespaces.set(`${group.name}__${fn.name}`, {name: fn.name, namespace: group.name});
      if (pathname === "/responses" && body)
        body = JSON.stringify(normalizeResponses(JSON.parse(body)));
      const upstream = await fetch(endpoint.replace(/\/$/, "") + pathname, {
        method: req.method,
        headers: { "Content-Type": "application/json", ...headers },
        body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : body,
        signal: abort.signal,
      });
      res.statusCode = upstream.status;
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") || "application/json",
      );
      const restore = (value: any): any => {
          if (Array.isArray(value)) return value.map(restore);
          if (!value || typeof value !== "object") return value;
          const result = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, restore(v)]));
          return value.type === "function_call" && namespaces.has(value.name) ? {...result, ...namespaces.get(value.name)} : result;
        };
      if (upstream.body && namespaces.size && upstream.headers.get("content-type")?.includes("application/json")) {
        res.end(JSON.stringify(restore(await upstream.json())));
      } else if (upstream.body && namespaces.size && upstream.headers.get("content-type")?.includes("text/event-stream")) {
        let pending = "";
        const decoder = new StringDecoder("utf8");
        const line = (value: string) => { if (!value.startsWith("data: ") || value.trim() === "data: [DONE]") return value; try { return "data: " + JSON.stringify(restore(JSON.parse(value.slice(6)))); } catch { return value; } };
        const wire = new Transform({ transform(chunk, _encoding, done) { pending += decoder.write(chunk); const lines = pending.split("\n"); pending = lines.pop()!; for (const item of lines) this.push(line(item) + "\n"); done(); }, flush(done) { pending += decoder.end(); if(pending)this.push(line(pending)); done(); } });
        const stream = Readable.fromWeb(upstream.body as any);
        stream.on("error", error => wire.destroy(error)); wire.on("error", () => res.destroy());
        stream.pipe(wire).pipe(res);
      } else if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
      else res.end();
    } catch (e) {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              message: (e as Error).message,
              type: "local_transport_error",
            },
          }),
        );
      } else res.end();
    }
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
