// Fetch the three feeds the promo site shows — Bluesky, YouTube, Rauversion — and write
// `feeds.json`. Zero dependencies: Node 18+ has `fetch`, and YouTube's RSS is regular
// enough to read without an XML parser.
//
//   node tools/feeds.mjs            fetch all three
//   node tools/feeds.mjs bluesky    fetch one, leave the others as they were
//   node tools/feeds.mjs --check    fetch nothing, just report what each source answers
//
// WHY THIS EXISTS RATHER THAN THE PAGE FETCHING FOR ITSELF. Only one of the three sends
// `Access-Control-Allow-Origin`, measured with `curl -I -H "Origin: https://example.com"`:
//
//     public.api.bsky.app          Access-Control-Allow-Origin: *      browser CAN fetch
//     www.youtube.com/feeds/...    (no header)                         browser CANNOT
//     music.el3v8or.com            (no header)                         browser CANNOT
//
// So two of the three can only be read from outside a browser, and the site reads all three
// from this file's output. Bluesky is ALSO refreshed live in the page (see assets/site.js)
// because it is the one that can be — the cache is its floor, not its ceiling.
//
// TWO FILES, ONE OWNER EACH. `content.json` is hand-written and this script only ever
// READS it, for the handles and the per-source item counts. `feeds.json` is generated and
// nothing hand-edits it. That split is what lets a scheduled refresh run without ever being
// able to clobber the site's copy.
//
// A SOURCE THAT FAILS KEEPS ITS LAST GOOD ANSWER. Every fetch is wrapped: on any error the
// previous `feeds.json` entry is carried forward with its original `fetched` timestamp and
// an `error` string added. A dead network must not blank the page, and a silent blank is worse
// than a stale list because nothing on the site would look wrong.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CONTENT = path.join(ROOT, "content.json");
const FEEDS = path.join(ROOT, "feeds.json");

const UA = "whalehop.net site builder (+https://whalehop.net) node-fetch";
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));
const want = (k) => !only.length || only.includes(k);

const cfg = JSON.parse(fs.readFileSync(CONTENT, "utf8"));
const prev = fs.existsSync(FEEDS) ? JSON.parse(fs.readFileSync(FEEDS, "utf8")) : {};
const S = cfg.social || {};
const LIM = cfg.feedLimits || {};

const nowISO = () => new Date().toISOString();
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const decode = (s) =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// ---------------------------------------------------------------------------
// Bluesky — the public AppView. No auth, no key, and the only one of the three that a
// browser may also call directly.
// ---------------------------------------------------------------------------
async function bluesky() {
  const actor = S.bluesky?.handle;
  if (!actor) throw new Error("social.bluesky.handle missing from content.json");
  const base = "https://public.api.bsky.app/xrpc";
  const limit = Math.min(50, (LIM.bluesky || 6) * 3); // over-fetch: replies and reposts get dropped below

  const profile = await getJSON(`${base}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  const feed = await getJSON(
    `${base}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}` +
    `&limit=${limit}&filter=posts_no_replies`
  );

  const items = [];
  for (const row of feed.feed || []) {
    // `reason` present = this is a repost of someone else's post. Skip: the site is showing
    // what he posted, and a repost carries another account's name and avatar into the panel.
    if (row.reason) continue;
    const p = row.post;
    if (!p?.record) continue;
    // at://did:plc:xxx/app.bsky.feed.post/<rkey> is not a URL anyone can open. The public
    // permalink is built from the HANDLE and the rkey, which is the last path segment.
    const rkey = String(p.uri).split("/").pop();
    const emb = p.embed || {};
    const images = (emb.images || emb.media?.images || [])
      .map((i) => ({ thumb: i.thumb, alt: clean(i.alt) }))
      .slice(0, 4);
    items.push({
      id: p.uri,
      url: `https://bsky.app/profile/${profile.handle}/post/${rkey}`,
      text: clean(p.record.text),
      date: p.record.createdAt || p.indexedAt,
      likes: p.likeCount || 0,
      reposts: p.repostCount || 0,
      replies: p.replyCount || 0,
      images,
      link: emb.external ? { url: emb.external.uri, title: clean(emb.external.title) } : null,
    });
    if (items.length >= (LIM.bluesky || 6)) break;
  }

  return {
    profile: {
      handle: profile.handle,
      displayName: profile.displayName || profile.handle,
      avatar: profile.avatar || null,
      description: clean(profile.description),
      followers: profile.followersCount || 0,
      posts: profile.postsCount || 0,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// YouTube — the channel RSS feed. No API key and no quota, which is the whole reason to use
// it over the Data API. It returns the 15 most recent uploads and nothing further back.
// ---------------------------------------------------------------------------
async function youtube() {
  const id = S.youtube?.channelId;
  if (!id) throw new Error("social.youtube.channelId missing from content.json");
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);

  const entries = xml.split("<entry>").slice(1);
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? decode(m[1]) : "";
  };
  const items = entries.slice(0, LIM.youtube || 4).map((b) => {
    const vid = pick(b, "yt:videoId");
    const thumb = (b.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1] || null;
    const views = (b.match(/<media:statistics[^>]*views="(\d+)"/) || [])[1];
    return {
      id: vid,
      url: `https://www.youtube.com/watch?v=${vid}`,
      title: clean(pick(b, "title")),
      date: pick(b, "published"),
      // hqdefault is 480x360 and always exists; maxresdefault 404s on plenty of uploads.
      thumb: thumb || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null),
      description: clean(pick(b, "media:description")).slice(0, 240),
      views: views ? Number(views) : null,
    };
  });

  // The feed's FIRST <title> is the channel's; entry titles come after. Splitting on <entry>
  // first is what keeps those apart — reading <title> off the whole document returns the
  // channel name and silently labels every video with it.
  const head = xml.split("<entry>")[0];
  const chanTitle = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
  return {
    profile: {
      channelId: id,
      title: decode(chanTitle || S.youtube.handle || ""),
      url: S.youtube?.url || `https://www.youtube.com/channel/${id}`,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Music — Rauversion (the software music.el3v8or.com runs). `<user>.json`, `<user>/tracks.json`
// and `<user>/albums.json` are plain JSON and need no auth.
// ---------------------------------------------------------------------------
async function music() {
  const host = (S.music?.host || "").replace(/\/+$/, "");
  const user = S.music?.user;
  if (!host || !user) throw new Error("social.music.host / .user missing from content.json");
  const abs = (u) => (!u ? null : /^https?:/.test(u) ? u : host + u);

  const [profile, tracks, albums] = await Promise.all([
    getJSON(`${host}/${user}.json`),
    getJSON(`${host}/${user}/tracks.json`),
    getJSON(`${host}/${user}/albums.json`).catch(() => ({ collection: [] })),
  ]);

  const u = profile.user || profile;
  const mmss = (sec) => {
    if (!sec) return null;
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return {
    profile: {
      username: u.username,
      displayName: u.display_name || u.username,
      bio: clean(u.bio),
      avatar: abs(u.avatar_url?.medium || u.avatar_url?.small || null),
      url: `${host}/${user}`,
      trackCount: (tracks.collection || []).length,
    },
    albums: (albums.collection || []).slice(0, LIM.albums || 3).map((a) => ({
      id: a.id,
      title: clean(a.title),
      url: `${host}/albums/${a.slug}`,
      cover: abs(a.cover_url?.medium || a.cover_url?.small || null),
      tracks: a.tracks_count ?? ((a.tracks || []).length || null),
      year: a.release_date ? String(a.release_date).slice(0, 4) : (a.created_at || "").slice(0, 4),
    })),
    items: (tracks.collection || [])
      // `peaks` is a 4,700-float waveform per track. Dropping it takes the payload from
      // ~1.4 MB to ~9 kB, and nothing on the site draws a waveform.
      .slice(0, LIM.music || 6)
      .map((t) => ({
        id: t.id,
        title: clean(t.title),
        url: `${host}/${user}/${t.slug}`,
        cover: abs(t.cover_url?.medium || t.cover_url?.small || null),
        audio: abs(t.mp3_audio_url || t.audio_url || null),
        duration: mmss(t.duration),
        tags: (t.tags || []).slice(0, 3),
        date: t.created_at,
        likes: t.likes_count || 0,
      })),
  };
}

// ---------------------------------------------------------------------------

const SOURCES = { bluesky, youtube, music };
const out = { generated: nowISO(), sources: { ...(prev.sources || {}) } };
let failed = 0;

for (const [key, fn] of Object.entries(SOURCES)) {
  if (!want(key)) continue;
  if (S[key]?.enabled === false) {
    out.sources[key] = { enabled: false, fetched: nowISO(), items: [] };
    console.log(`${key.padEnd(8)} disabled in content.json`);
    continue;
  }
  const t0 = Date.now();
  try {
    const data = await fn();
    const ms = Date.now() - t0;
    if (CHECK) { console.log(`${key.padEnd(8)} ok   ${String(ms).padStart(5)}ms  ${data.items.length} items`); continue; }
    out.sources[key] = { enabled: true, fetched: nowISO(), ...data };
    console.log(`${key.padEnd(8)} ok   ${String(ms).padStart(5)}ms  ${data.items.length} items`);
  } catch (e) {
    failed++;
    const keep = prev.sources?.[key];
    console.error(`${key.padEnd(8)} FAIL      ${e.message}`);
    if (CHECK) continue;
    // carry the last good answer forward rather than publishing an empty panel
    out.sources[key] = keep
      ? { ...keep, error: e.message, errorAt: nowISO() }
      : { enabled: true, fetched: null, error: e.message, errorAt: nowISO(), items: [] };
  }
}

if (!CHECK) {
  fs.writeFileSync(FEEDS, JSON.stringify(out, null, 2) + "\n");
  const kb = (fs.statSync(FEEDS).size / 1024).toFixed(1);
  console.log(`\nwrote feeds.json  ${kb}kB`);
}

// Exit non-zero only if EVERY requested source failed. One dead source is a stale panel; all
// three dead is a broken run, and a scheduled job should say so.
const asked = Object.keys(SOURCES).filter(want).length;
process.exit(failed === asked && asked > 0 ? 1 : 0);
