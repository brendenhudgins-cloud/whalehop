// Post a sounding to Bluesky as @whale-hop-dev.
//
//     node tools/post-sounding.mjs                 what WOULD be posted. Writes nothing. No auth.
//     node tools/post-sounding.mjs --post          actually post it
//     node tools/post-sounding.mjs --date 2026-08-22   a specific day rather than the newest
//     node tools/post-sounding.mjs --all           every unposted entry, oldest first
//
// DRY RUN IS THE DEFAULT AND THAT IS DELIBERATE. Everything else in this repo can be undone
// by editing a file; a post cannot. `--post` is the only thing that writes to the network,
// and it is never the default, so a mistyped flag costs nothing.
//
// THE SECRET IS NEVER IN THIS REPO. This file is public. It reads the app password from the
// environment and there is no fallback, no config key and no committed file to forget to
// gitignore:
//     BSKY_HANDLE          default whale-hop-dev.bsky.social
//     BSKY_APP_PASSWORD    from Bluesky Settings > App Passwords -- NOT the account password
// An app password can be revoked from Bluesky without touching any code here, which is the
// whole reason to use one.
//
// DEDUPE IS STATELESS, and that is what makes it safe to run on a schedule. Nothing records
// what has been posted; instead the account's own recent posts are read back through the
// PUBLIC api and anything already there is skipped. A local ledger would drift the first time
// a run half-failed, and a `posted:true` field in soundings.json would mean this tool writes
// to a file the scheduled writer owns. Reading the timeline cannot drift, because the
// timeline IS the record. Deleting a post therefore lets it post again, which is the correct
// behaviour rather than a bug.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };

const LIVE = has("--post");
const ALL = has("--all");
const DATE = val("--date");

const HANDLE = process.env.BSKY_HANDLE || "whale-hop-dev.bsky.social";
const PASSWORD = process.env.BSKY_APP_PASSWORD || null;

const PUBLIC = "https://public.api.bsky.app/xrpc";
const PDS = "https://bsky.social/xrpc";

// Bluesky counts GRAPHEMES, not code units. Everything written so far lands around 130-260,
// so this has never bitten -- it is here so that the day a long one is written, the tool
// refuses it out loud instead of posting something cut off mid-sentence.
const LIMIT = 300;
const graphemes = (s) =>
  typeof Intl !== "undefined" && Intl.Segmenter
    ? [...new Intl.Segmenter().segment(s)].length
    : [...s].length;

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${body.error || ""} ${body.message || ""}`.trim());
  return body;
}

/* Everything already on the account, as a set of exact post texts. Public endpoint, so this
   works with no credential at all -- which is why a dry run can tell you truthfully whether
   something would be skipped, rather than only guessing. */
async function alreadyPosted() {
  const feed = await getJSON(
    `${PUBLIC}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(HANDLE)}&limit=100&filter=posts_no_replies`
  );
  const seen = new Set();
  for (const it of feed.feed || []) {
    const t = it?.post?.record?.text;
    if (typeof t === "string") seen.add(t.trim());
  }
  return seen;
}

async function login() {
  if (!PASSWORD) {
    throw new Error(
      "BSKY_APP_PASSWORD is not set.\n" +
      "  Create one at Bluesky > Settings > App Passwords (not the account password), then:\n" +
      `    setx BSKY_APP_PASSWORD "the-app-password"\n` +
      "  and open a NEW shell -- setx only affects processes started after it."
    );
  }
  const s = await getJSON(`${PDS}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
  });
  return { jwt: s.accessJwt, did: s.did };
}

async function post(text, session) {
  const rec = await getJSON(`${PDS}/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.jwt}` },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: ["en"],
      },
    }),
  });
  // at://did:plc:xxx/app.bsky.feed.post/<rkey> is not a link anyone can open; the same
  // handle+rkey assembly feeds.mjs does for the site's panel.
  const rkey = String(rec.uri || "").split("/").pop();
  return `https://bsky.app/profile/${HANDLE}/post/${rkey}`;
}

// ---------------------------------------------------------------------------

// NOTHING BELOW CALLS process.exit(). Ending the process while fetch still holds keepalive
// sockets trips a libuv assertion on Windows -- `Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)` -- and exits 127 AFTER printing a perfectly successful dry run. A
// scheduled caller checking the exit code would read every good run as a failure. Set
// process.exitCode and return instead; the process then ends once the sockets drain.
async function main() {
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "soundings.json"), "utf8"));
const entries = (data.entries || []).filter((e) => e && typeof e.text === "string" && e.text.trim());
if (!entries.length) { console.error("soundings.json has no entries"); process.exitCode = 2; return; }

let todo;
if (DATE) {
  todo = entries.filter((e) => e.date === DATE);
  if (!todo.length) { console.error(`no sounding dated ${DATE}`); process.exitCode = 2; return; }
} else if (ALL) {
  todo = [...entries].reverse();          // oldest first, so a backlog reads in order
} else {
  todo = [entries[0]];                    // soundings.json is newest-first
}

const seen = await alreadyPosted();

// THE POST IS THE SOUNDING, with nothing appended. No link, no hashtags, no "read more".
// The format was written to stand alone on the site and it stands alone here; a URL on every
// post turns a voice into a funnel, and the profile bio is where the link belongs.
const queue = [];
for (const e of todo) {
  const text = e.text.trim();
  const n = graphemes(text);
  if (seen.has(text)) { console.log(`skip   ${e.date}  already on the account`); continue; }
  if (n > LIMIT) { console.log(`SKIP   ${e.date}  ${n} graphemes, over the ${LIMIT} limit -- not truncating`); continue; }
  queue.push({ ...e, text, n });
}

if (!queue.length) { console.log("\nnothing to post."); return; }

console.log(`\n${LIVE ? "POSTING" : "DRY RUN"} as @${HANDLE}\n`);
for (const e of queue) {
  console.log("  " + "-".repeat(72));
  console.log(`  ${e.date}  ${e.kind}  ${e.n}/${LIMIT}`);
  console.log("  " + "-".repeat(72));
  for (const line of e.text.match(/.{1,70}(\s|$)/g) || [e.text]) console.log("  " + line.trim());
  console.log();
}

if (!LIVE) {
  console.log(`${queue.length} post(s) would go out. Nothing was sent -- add --post to send.`);
  return;
}

const session = await login();
for (const e of queue) {
  const url = await post(e.text, session);
  console.log(`posted ${e.date}  ${url}`);
}
}

await main().catch((e) => {
  console.error("\n" + e.message);
  process.exitCode = 1;
});
