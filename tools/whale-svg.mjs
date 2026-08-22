/* Export a traced whale hull from the game as a standalone SVG for the site.
   ---------------------------------------------------------------------------
   The site shows the whale the GAME paints, not a redrawing of it. Everything
   here — the paths, the skin, the shade maths, the band offsets, the outline
   width — is read out of whale-hop.html at run time, so this cannot drift from
   the build the way a hand-exported asset would. Re-run it when the hull, the
   rig or the palette changes, exactly like tools/shots.mjs.

       node tools/whale-svg.mjs --game "C:/path/to/whale-hop.html"
       node tools/whale-svg.mjs --game <path> --hull orca --skin ember

   WHY THIS AND NOT THE SOURCE SVG in the game repo's IMPORTED ART SVGS/: that
   file is the ARTWORK, in the artist's colours. What ships in the game is that
   artwork re-painted per skin by skinShades(), which is why the whale in the
   screenshots is pale cyan and the source file is not. Exporting the source
   would put a whale on the site that never appears in the game. */

import { readFileSync, writeFileSync } from "node:fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const GAME = arg("game", process.env.WHALE_HOP || "../Whale Olympics/whale-hop.html");
const HULL = arg("hull", "character");
const SKIN = arg("skin", "deep");
const OUT  = arg("out", `img/whale-${HULL}.svg`);

const src = readFileSync(GAME, "utf8");

/* Pull a balanced {...} or [...] literal out of the source by its declaration.
   Brace-counting rather than a regex because these literals contain braces. */
function literal(decl, open) {
  const close = open === "{" ? "}" : "]";
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`not found in game source: ${decl}`);
  const j = src.indexOf(open, i);
  let d = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close && !--d) break;
  }
  return src.slice(j, k + 1);
}

/* The colour helpers come from the game verbatim rather than being reimplemented:
   rgb2hex rounds and clamps, and a shade that differs in the last digit from the
   one the game draws is exactly the kind of drift this script exists to prevent. */
/* Each helper is a single statement, but hex2rgb spans three lines and contains
   semicolons inside its own body, so "slice to the first ;" truncates it into
   syntactically invalid JS. Scan to the first semicolon at DEPTH ZERO instead. */
function statement(decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`not found in game source: ${decl}`);
  let d = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") d--;
    else if (c === ";" && d === 0) return src.slice(i, k + 1);
  }
  throw new Error(`unterminated statement: ${decl}`);
}

const helpers = ["const hex2rgb=", "const rgb2hex=", "const mixc=", "const lum="]
  .map(statement).join("");

const SKINS = eval(`(${literal("const WHALE_SKINS=", "[")})`);
const RIG   = eval(`(${literal("const WHALE_RIG=", "{")})`);

const HULL_DECL = { character: "const WHALE_CHAR=", orca: "const WHALE_ORCA=",
  baleen: "const WHALE_BALEEN=", humpback: "const WHALE_HUMPBACK=",
  manatee: "const WHALE_MANATEE=", narwhal: "const WHALE_NARWHAL=",
  mshark: "const WHALE_MSHARK=" };
if (!HULL_DECL[HULL]) throw new Error(`unknown hull: ${HULL}`);
const A = eval(`(${literal(HULL_DECL[HULL], "{")})`);

/* w/cx/cy are assigned AFTER the object literal for the character — "the character
   measured its own width/centre before the art carried them" — so the literal alone
   is short three fields and A.cy comes out undefined. Reading them back off the
   source is the difference between drawing the shading bands and silently drawing
   them at NaN. */
for (const f of ["w", "cx", "cy"]) {
  if (A[f] != null) continue;
  const key = HULL_DECL[HULL].slice(6).replace("=", "") + "." + f + "=";
  const i = src.indexOf(key);
  if (i < 0) continue;
  const v = parseFloat(src.slice(i + key.length));   // parseFloat stops at the ";"
  if (Number.isFinite(v)) A[f] = v;
}
if (A.cy == null) throw new Error(`${HULL}: no cy — cannot place the shading bands`);

/* skinShades(), but for a NAMED skin instead of the saved one. */
const SK = SKINS.find((s) => s.id === SKIN);
if (!SK) throw new Error(`unknown skin: ${SKIN} (have ${SKINS.map((s) => s.id).join(", ")})`);
const SH = eval(`${helpers}
  (() => {
    const SK = ${JSON.stringify(SK)};
    const main = lum(SK.body) >= lum(SK.cols[0]) ? SK.body : SK.cols[0];
    const dark = lum(SK.body) >= lum(SK.cols[0]) ? SK.edge : SK.body;
    return { main,
      top:   mixc(main, "#ffffff", 0.42),
      upper: mixc(main, "#ffffff", 0.16),
      lower: mixc(main, dark, 0.34),
      belly: mixc(main, dark, 0.60),
      deep:  mixc(main, dark, 0.82),
      line:  SK.edge,
      rim:   mixc(main, "#ffffff", 0.72),
      halo:  SK.halo || main,
      eye:   lum(main) > 0.5 ? SK.edge : "#ffffff" };
  })()`);

const P = RIG[HULL].paint;
const of = (role) => SH[P[role]] || SH.main;
const paths = A.p.map(([r, d]) => ({ role: A.roles[r], d }));
const body = paths.find((p) => p.role === "body");
if (!body) throw new Error(`${HULL}: no body path`);

/* A loose bbox from every coordinate pair in the path data. Bezier control points
   sit outside the curve they describe, so this over-estimates — which is the safe
   direction for a crop, and reads as padding rather than as clipping. */
function bbox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { d } of list) {
    const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]);  x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
}

const stroke = A.vb * (P.outlineW || 0.02);
const b = bbox(paths);
const pad = stroke;                      // the outline is centred, so half spills out
const vx = b.x0 - pad, vy = b.y0 - pad;
const vw = (b.x1 - b.x0) + pad * 2, vh = (b.y1 - b.y0) + pad * 2;

const marks = paths.filter((p) => ["accent", "mark", "detail", "eye", "pupil"].includes(p.role));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* Draw order is paintTracedWhale's: body, then the two clipped shading bands, then
   the marks in role order, then the outline stroked last over everything. */
/* WIDTH AND HEIGHT AS WELL AS THE viewBox. A viewBox alone gives an <svg> a ratio
   but no intrinsic SIZE, and an <img> laid out with `height:auto` then resolves the
   height to zero — the box drew 393px wide and 0px tall. Stating both makes the
   intrinsic ratio unambiguous everywhere and lets the page reserve the space before
   the (lazily loaded) file arrives, so nothing below it jumps. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${Math.round(vw)}" height="${Math.round(vh)}" role="img" aria-label="${esc(RIG[HULL].name)} whale">
  <title>${esc(RIG[HULL].name)}</title>
  <defs><clipPath id="body"><path d="${body.d}"/></clipPath></defs>
  <g>
    <path d="${body.d}" fill="${of("body")}"/>
${P.bands ? `    <g clip-path="url(#body)">
      <rect x="${vx}" y="${A.cy * 1.10}" width="${vw}" height="${vh * 2}" fill="${SH.lower}"/>
      <rect x="${vx}" y="${A.cy * 1.22}" width="${vw}" height="${vh * 2}" fill="${SH.belly}"/>
    </g>\n` : ""}${marks.map((m) => `    <path d="${m.d}" fill="${of(m.role)}"/>`).join("\n")}
    <path d="${body.d}" fill="none" stroke="${of("outline")}" stroke-width="${stroke}" stroke-linejoin="round"/>
  </g>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`${OUT}  hull=${HULL} skin=${SKIN}`);
console.log(`  viewBox ${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}  stroke ${stroke}`);
console.log(`  body=${of("body")} mark=${of("mark")} eye=${of("eye")} outline=${of("outline")} bands=${P.bands ? "on" : "off"}`);
console.log(`  intrinsic ${Math.round(vw)}x${Math.round(vh)}  ${(svg.length / 1024).toFixed(1)} kB`);
