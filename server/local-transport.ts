import http from "node:http";
import { Readable } from "node:stream";

export function normalizeResponses(body: any) {
  if (!Array.isArray(body.input)) return body;
  const instructions = [body.instructions].filter(
    (s): s is string => typeof s === "string" && !!s,
  );
  const input = body.input.filter((item: any) => {
    if (!["system", "developer"].includes(item.role)) return true;
    const text =
      typeof item.content === "string"
        ? item.content
        : (item.content || []).map((c: any) => c.text || "").join("\n");
    if (text) instructions.push(text);
    return false;
  });
  return { ...body, input, instructions: instructions.join("\n\n") };
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
      if (upstream.body) Readable.fromWeb(upstream.body as any).pipe(res);
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
