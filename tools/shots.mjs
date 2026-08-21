// Capture this site's screenshots FROM THE REAL GAME, so the site can never advertise a build
// that no longer exists. Same headless-Chrome driver as the game repo's `tools/shoot.js` — read
// that file's header first, its three traps all apply here and two of them bit while writing this:
//
//   1. start Chrome once, and leave it running:
//        "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
//          --allow-file-access-from-files --remote-debugging-port=9222 \
//          --user-data-dir=/tmp/cprof-site --no-first-run about:blank &
//   2. node tools/shots.mjs [name ...]      (no names = every scene)
//
// Writes img/<name>.jpg and prints the altitude + band each scene actually reached, which
// is the check that matters: a scene that silently fell out of its band still produces a
// perfectly good screenshot OF THE WRONG PLACE. The first run of this file put SUNSET BAND at
// -84m because gravity had four seconds to work, and the picture looked fine.
//
// WHY JPEG AT 1600x900 AND NOT A RESIZE PASS. CDP encodes JPEG itself, and the game's UI is
// authored at 1920x1080 and scaled to whatever it is given (see NOTES-visual-identity.md,
// "Things not to undo" #5) — so asking Chrome for a 1600x900 window produces a correctly
// composed frame rather than a downsampled one. No image library is involved, which is the
// only reason this runs with no npm install.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "img");

// THE GAME IS NOT IN THIS REPO. whale-hop.html lives in the private game repo, so its path is
// local configuration rather than something that can be committed. In order of precedence:
//     node tools/shots.mjs --game "C:/path/to/whale-hop.html"
//     WHALE_HOP=C:/path/to/whale-hop.html node tools/shots.mjs
//     ../Whale Olympics/whale-hop.html          (the default sibling-checkout layout)
const gi = process.argv.indexOf("--game");
const GAME_PATH = path.resolve(
  gi > -1 ? process.argv[gi + 1]
          : process.env.WHALE_HOP || path.join(ROOT, "..", "Whale Olympics", "whale-hop.html")
);
if (!fs.existsSync(GAME_PATH)) {
  console.error(`cannot find whale-hop.html at:`);
  console.error(`  ${GAME_PATH}`);
  console.error(`pass --game <path>, or set WHALE_HOP. The game is in a separate private repo.`);
  process.exit(2);
}
const GAME = "file:///" + GAME_PATH.split(path.sep).join("/").replace(/ /g, "%20");

const W = 1600, H = 900, QUALITY = 82;

// ---------------------------------------------------------------------------
// The scenes. `alt` pins the whale to an altitude while the world streams in around it;
// `level` opens an authored level first; `raw` replaces the body entirely (the title screen).
// Pinning rather than flying is deliberate: a free flight ends wherever physics put it, and
// three attempts at "just let it climb" all overshot into the same washed-out upper sky.
// ---------------------------------------------------------------------------
const SCENES = [
  // The hero PLATE: the title screen's world render with the interface layer hidden. The
  // page draws its own logo over this, and the game's own logo underneath it produced two
  // overlapping wordmarks — legible in neither.
  { name: "hero", raw: `document.querySelector("#ui").style.display = "none"; await sleep(2600);`,
    note: "title-screen world, no UI — the hero plate" },
  { name: "title", raw: `await sleep(2600);`, note: "the title screen, interface and all" },
  { name: "sunset", alt: 1100, note: "SUNSET BAND — the pink band, gulls and school" },
  { name: "veil", alt: 4200, note: "LASSEN VEIL" },
  { name: "orbit", alt: 18000, note: "LOW ORBIT" },
  { name: "stars", alt: 30000, note: "SEA OF STARS — the ringed planet" },
  { name: "greatwhale", alt: 250000, note: "THE GREAT WHALE" },
  { name: "arcade", alt: 340000, note: "THE ARCADE — six saturated colours on black" },
  { name: "kelp", alt: -420, note: "KELP GARDENS — under the waterline" },
  { name: "rising", level: "THE RISING", alt: -340, note: "THE RISING — SHALLOW OCEAN, spent copper" },
  { name: "sugar", level: "SPUN SUGAR", alt: 900, note: "SPUN SUGAR — LOW SKY, the spun veil" },
];

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function body(sc) {
  if (sc.raw) return sc.raw;
  const open = sc.level ? `App.playLevel(${JSON.stringify(sc.level)});` : `App.startRun();`;
  // Hold y on an interval rather than setting it once: the sim keeps integrating gravity, and
  // a single assignment is undone within a few ticks. x is left to the sim so the world scrolls
  // and the streamer actually produces content either side of the camera.
  return `
    ${open}
    await sleep(400);
    g = App.game;
    const hold = () => { g.p.y = ${sc.alt}; g.cam.y = ${sc.alt}; g.v.x = 1100; g.v.y = 120; };
    hold();
    const iv = setInterval(hold, 40);
    await sleep(4200);
    clearInterval(iv); hold();
    await sleep(300);
  `;
}

function script(sc) {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let g = null;
    await document.fonts.ready;
    ${body(sc)}
    /* A SCREENSHOT NEEDS A COMPOSITED FRAME — stop the loop, then let one settle. */
    App.loop = function(){};
    await sleep(400);
    g = App.game;
    if (!g) return { scene: ${JSON.stringify(sc.name)}, state: App.state };
    const alt = g.p.y;
    return { scene: ${JSON.stringify(sc.name)}, alt: Math.round(alt),
             band: (BANDS.find(b => alt >= b.lo && alt < b.hi) || {}).n, objN: g.objN };
  })()`;
}

const targets = process.argv.slice(2).filter((a, i, all) =>
  a !== "--game" && all[i - 1] !== "--game");
const todo = targets.length ? SCENES.filter((s) => targets.includes(s.name)) : SCENES;
if (!todo.length) {
  console.error(`no scene matched. known: ${SCENES.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

let list = [];
for (let i = 0; i < 40; i++) {
  try {
    list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    if (list.length) break;
  } catch { /* chrome not up yet */ }
  await sleep(250);
}
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target — is Chrome running with --remote-debugging-port=9222?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

for (const sc of todo) {
  // THE PROFILE CACHES: whale-hop.html changes constantly, so every load is cache-busted.
  await send("Page.navigate", { url: `${GAME}?v=${id}-${process.pid}` });
  await sleep(3500);

  const r = await send("Runtime.evaluate", {
    expression: script(sc), awaitPromise: true, returnByValue: true,
  });
  const got = r.result?.result?.value ?? r.result?.exceptionDetails ?? null;

  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: QUALITY });
  const data = shot.result?.data;
  if (!data) { console.error(`${sc.name}: no screenshot data`); continue; }
  const file = path.join(OUT, `${sc.name}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`${sc.name.padEnd(11)} ${kb.padStart(4)}kB  ${JSON.stringify(got)}`);
}

ws.close();
console.log(`\nwrote ${todo.length} scene(s) to img/`);
