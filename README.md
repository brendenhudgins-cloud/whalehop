# whalehop.net

The promo site for **WHALE HOP — Lassen Seas**. Static, no framework, no build step, no
dependencies. Deployed to GitHub Pages by `.github/workflows/pages.yml`.

**The game itself is not in this repo.** It is a single-file canvas game in a separate private
repo; only the site lives here. The screenshots under `img/` are real frames of the running
build, captured by `tools/shots.mjs` — with two exceptions, `promo-desk.jpg` and
`promo-card.jpg`, which are composed promo art. Those two are deliberately kept OUT of the
gallery, because the gallery tells the reader every frame in it is a screenshot.

**The tools are not in this repo either, and that is on purpose.** This repo is public and
everything in it is served from whalehop.net; the capture and export tools drive
`whale-hop.html` by name, so publishing them publishes the shape of a private build. They live
on the developer machine, still under `tools/`, and every command below assumes you are there.
`.gitignore` refuses to stage them, verified by trying.

---

## To change what the site says

Edit **`content.json`** and commit. That is the whole procedure — every word, link, caption
and feed limit is in that one file. Nothing else needs touching.

```jsonc
"cta": { "steam": { "url": null, … } }   // set url → the button goes live
"sections": { "features": { "eyebrow": … } }    // every section eyebrow, heading and subhead
"shots": [ … ]                            // first entry spans full width
"spec": { "platforms": {…}, "modes": {…} }      // the PLATFORMS / FEATURES strip
"feedLimits": { "bluesky": 6, … }
"social": { "youtube": { "enabled": false } }   // drops the panel and stops fetching it
```

**"Every word" is meant literally, and once was not.** The section eyebrows and headings —
`WHAT IT IS`, `HOW IT PLAYS`, `Nineteen bands, bottom to top` — were literals in `index.html`
for the first two versions of this site, so "edit `content.json`, commit, done" quietly failed
for six strings on the page. They are ids now, filled by `renderSections`, and `index.html`
keeps its own text as the fallback: a missing key leaves the built-in wording rather than a
blank heading.

**Write it for a stranger.** The first version of the copy was assembled out of the game's
design documents and inherited their vocabulary — *band*, *deterministic*, *traced hull*, *the
glyph original*, *authored level* — and got as far as a live domain before anyone noticed that
it never once said what you do with your hands. Numbers still carry the voice; the words around
them have to be ones a reader already owns. Define a term the first time it appears, or drop it.

**Two data files, one owner each — do not mix them up:**

| file | written by | holds |
|---|---|---|
| `content.json` | **you, by hand** | everything the page says |
| `feeds.json` | `tools/feeds.mjs` | the cached Bluesky / YouTube / music items |

`feeds.mjs` only ever *reads* `content.json`. That split is why a refresh can never revert
your edits, whoever runs it and whenever.

---

## The feeds

Three sources, refreshed **locally** by `tools/feeds.mjs` and committed as `feeds.json`.

This used to run in the deploy job every six hours. It does not any more: the tools are
not in this repo (it is public and they describe a private build), so the fetch step went
with them. **The feeds are now exactly as fresh as the last local run** — which means the
"updated Nh ago" line on the page is a claim about when someone last ran the script, and
it drifts if nobody does. Run it before a push you care about.

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
node tools/feeds.mjs --verify   # open every link it emits and prove it renders
```

**Run `--verify` after any change to how a link is built.** A status code is not enough:
Rauversion is client-rendered and answers *every* path — including nonsense — with `HTTP 200`
and a 16-byte stub, then draws "Page not found" in JavaScript. The first version of this site
guessed the routes as `/<user>/<slug>` and `/albums/<slug>`, every one returned 200, and twelve
dead track links shipped. The real routes are `/tracks/<slug>` and `/playlists/<slug>` — an
album *is* a playlist with `playlist_type:"album"`, which is why there is no `/albums/` route
at all.

`--verify` fetches each link and demands a `<title>`, which is the signature that separates a
real page (~3.4 kB, titled) from the stub (16 bytes, untitled). It runs over Bluesky and
YouTube too, where a wrongly *constructed* link would look identical from the outside.

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

### Two things GoDaddy does that fight this

**1. `www` already has a CNAME, so adding one conflicts.** GoDaddy ships every new domain with
`CNAME www → @`. A name can hold exactly one CNAME, so the record above is an **edit of the
existing `www` row**, not a new row. Changing the value is the whole operation.

Leaving GoDaddy's default in place *appears* to work — `www` resolves through the apex to the
GitHub IPs — but GitHub's docs warn against exactly that shape: *"If you point your custom
subdomain to your apex domain, you will encounter issues with enforcing HTTPS."* Point it at
the owner, not at the apex. And at the **owner** — `brendenhudgins-cloud.github.io` — never at
the repository, which fails silently by serving the owner's root Pages site.

**2. The parking A records survive, and they are not harmless.** GoDaddy points a new domain at
its own parking service and *adding* the GitHub A records does not remove them. The apex then
answers with six addresses:

```
185.199.108.153   GitHub          server: GitHub.com
185.199.109.153   GitHub
185.199.110.153   GitHub
185.199.111.153   GitHub
76.223.105.230    GoDaddy parking  server: DPS/2.0.0   ← delete
13.248.243.5      GoDaddy parking  server: DPS/2.0.0   ← delete
```

DNS round-robins across all six, so **roughly a third of visitors get the parking page instead
of the site** — intermittently, which is the worst way for it to fail: it looks fine every time
you check it and broken to every third person. `nslookup -type=A whalehop.net 8.8.8.8` should
list exactly the four `185.199.*` addresses and nothing else.

Once DNS is right: repo Settings → Pages → Custom domain → `whalehop.net`, wait for the DNS
check to go green, then tick **Enforce HTTPS**. The Let's Encrypt certificate is issued after
the check passes and can take up to an hour; until then the domain is http-only, which is
expected rather than broken.

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
