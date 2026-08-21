// Local preview. GitHub Pages serves this repo's root statically; this serves the same
// bytes over http:// so `fetch("content.json")` works, which file:// blocks.
//   node tools/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8099);
const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".jpg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon" };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!f.startsWith(ROOT)) { res.writeHead(403).end("no"); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream",
                       "Cache-Control": "no-cache" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`site → http://localhost:${PORT}`));
