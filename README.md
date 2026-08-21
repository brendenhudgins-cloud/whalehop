# whalehop.net

The promo site for **WHALE HOP — Lassen Seas**. Static, no framework, no build step, no
dependencies. Deployed to GitHub Pages by `.github/workflows/pages.yml`.

**The game itself is not in this repo.** It is a single-file canvas game in a separate private
repo; only the site lives here. The screenshots under `img/` are real frames of the running
build, captured by `tools/shots.mjs`.

---

## To change what the site says

Edit **`content.json`** and commit. That is the whole procedure — every word, link, caption
and feed limit is in that one file. Nothing else needs touching.

```jsonc
"cta": { "steam": { "url": null, … } }   // set url → the button goes live
"shots": [ … ]                            // first entry spans full width
"feedLimits": { "bluesky": 6, … }
"social": { "youtube": { "enabled": false } }   // drops the panel and stops fetching it
```

**Two data files, one owner each — do not mix them up:**

| file | written by | holds |
|---|---|---|
| `content.json` | **you, by hand** | everything the page says |
| `feeds.json` | `tools/feeds.mjs` | the cached Bluesky / YouTube / music items |

`feeds.mjs` only ever *reads* `content.json`. That split is why a refresh can run every six
hours without any chance of reverting your edits.

---

## The feeds

Three sources, refreshed every six hours by the deploy workflow and on every push.

| source | endpoint | `Access-Control-Allow-Origin` |
|---|---|---|
| Bluesky | `public.api.bsky.app` | **`*`** |
| YouTube | channel RSS | *(none)* |
| Music | Rauversion JSON | *(none)* |

Two of the three send no CORS header, so they **cannot** be read from a browser at all — which
is why there is a fetch step rather than the page fetching for itself. Bluesky is additionally
refreshed live in the page, because it is the one that can be (`social.bluesky.live: true`).

**The cache is the floor, not the ceiling.** The cached list renders first and a live fetch
only replaces it on success. If a source throws, `feeds.mjs` carries its previous entry forward
with an `error` field rather than writing an empty list — a dead API gives a stale panel, never
a blank one. A blank one is worse, because nothing about it looks wrong.

---

## Running it locally

```bash
node tools/serve.mjs            # → http://localhost:8099   (file:// blocks fetch)
node tools/feeds.mjs            # refresh all three feeds
node tools/feeds.mjs bluesky    # just one
node tools/feeds.mjs --check    # fetch and report, write nothing
```

Re-capturing screenshots needs the game and a headless Chrome:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --allow-file-access-from-files --remote-debugging-port=9222 \
  --user-data-dir=/tmp/cprof-site --no-first-run about:blank &

node tools/shots.mjs --game "C:/path/to/whale-hop.html"          # every scene
node tools/shots.mjs --game "C:/path/to/whale-hop.html" arcade   # just one
```

`shots.mjs` prints the altitude and band each scene actually reached. **That line is the check,
not the picture** — a scene that quietly fell out of its band still produces a perfectly good
screenshot of the wrong place, which is exactly what happened on the first run.

---

## The domain

`whalehop.net`, apex, on GoDaddy nameservers. `CNAME` holds the bare domain and is part of the
deployed artifact — with the Actions deploy flow there is no `gh-pages` branch for GitHub to
write a CNAME into, so the file must be in the published directory or the custom domain is
dropped on every deploy.

An apex domain needs A and AAAA records; a CNAME at the apex is not legal DNS and GoDaddy will
refuse it.

```
Type   Name   Value
A      @      185.199.108.153
A      @      185.199.109.153
A      @      185.199.110.153
A      @      185.199.111.153
AAAA   @      2606:50c0:8000::153
AAAA   @      2606:50c0:8001::153
AAAA   @      2606:50c0:8002::153
AAAA   @      2606:50c0:8003::153
CNAME  www    brendenhudgins-cloud.github.io.
```

The `www` record points at the **owner**, never the repository name — that is the detail people
get wrong, and it fails silently by serving the owner's root Pages site instead.

---

## Layout

```
index.html          the page — structure only; everything else is rendered from content.json
assets/site.css     the look. Palette, panel chrome and focus rules are the game's, verbatim
assets/site.js      reads content.json + feeds.json, builds the DOM, refreshes Bluesky live
content.json        ← edit this
feeds.json          ← generated; do not edit
img/                real frames of the running game
CNAME               whalehop.net
tools/feeds.mjs     the three feeds → feeds.json
tools/shots.mjs     the game → img/*.jpg   (needs the game repo)
tools/serve.mjs     local preview
```

The page is ordered as **a climb**: scrolling down goes *up* through the game's sky, the fixed
left rail is the game's own HUD height map, and the gallery runs −85m to 340,000m.
