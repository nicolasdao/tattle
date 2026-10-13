#!/bin/sh
# Writes the published release v<version> into the website's pages, so hey-tattle.com names it and links its DMG even
# without JavaScript or GitHub's API, and nothing shifts when the page script fills them in. website/index.html: the
# three Download for Mac links (hero, header bar, sign-off), the version and size under the button, the footer's "Latest
# release" line (date and release notes), and the JSON-LD softwareVersion, downloadUrl, fileSize and releaseNotes.
# website/docs.html: the version beside its Download button.
# Reads everything from the published GitHub Release, so run it only after deploy.sh. Changes no other file, commits
# nothing, and can be run again. The page's own script still refreshes these from GitHub when it loads.
#   update-website.sh <version>
set -e
version="$1"
[ -n "$version" ] || { echo "usage: update-website.sh <version>"; exit 1; }
[ -f website/index.html ] || { echo "no website/index.html: run from the project root"; exit 1; }
json="$(gh release view "v$version" --json tagName,publishedAt,url,assets 2>/dev/null)" || { echo "v$version is not published: run deploy.sh first"; exit 1; }

RELEASE_JSON="$json" VERSION="$version" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const r = JSON.parse(process.env.RELEASE_JSON), version = process.env.VERSION;
const dmg = r.assets.find((a) => a.name === `Tattle-${version}-arm64.dmg`);
if (!dmg) { console.log(`the release has no Tattle-${version}-arm64.dmg`); process.exit(1); }
const date = r.publishedAt.slice(0, 10);
// The same wording the page script (website/assets/download.js) renders, so nothing changes when it runs.
const released = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const v = { tag: r.tagName, url: dmg.url, size: `${Math.round(dmg.size / 1e6)} MB`, notes: r.url };
// per page: [pattern, replacement, how many the page must have]
const pages = {
  "website/index.html": [
  [/(data-download href=")[^"]*(")/g, `$1${v.url}$2`, 3],
  [/(<span data-version>)[^<]*(<\/span>)/g, `$1${v.tag}$2`, 1],
  [/(<b data-version>)[^<]*(<\/b>)/g, `$1${v.tag}$2`, 1],
  [/(<span data-size>)[^<]*(<\/span>)/g, `$1${v.size}$2`, 1],
  [/<time data-released[^>]*>[^<]*<\/time>/g, `<time data-released datetime="${date}">${released}</time>`, 1],
  [/(data-notes href=")[^"]*(")/g, `$1${v.notes}$2`, 1],
  [/<span class="ver"( hidden)?>/g, `<span class="ver">`, 1],
  [/(<p class="fine-rel" data-release)( hidden)?>/g, `$1>`, 1],
  [/("softwareVersion": ")[^"]*(")/g, `$1${version}$2`, 1],
  [/("downloadUrl": ")[^"]*(")/g, `$1${v.url}$2`, 1],
  [/("fileSize": ")[^"]*(")/g, `$1${v.size}$2`, 1],
  [/("releaseNotes": ")[^"]*(")/g, `$1${v.notes}$2`, 1],
  ],
  "website/docs.html": [
  [/<span data-release( hidden)?> · <span data-version>[^<]*<\/span><\/span>/g, `<span data-release> · <span data-version>${v.tag}</span></span>`, 1],
  ],
};
// every page is checked before any is written, so a page that changed shape leaves both untouched
const out = Object.entries(pages).map(([page, edits]) => {
  let html = readFileSync(page, "utf8");
  for (const [re, to, want] of edits) {
    const n = (html.match(re) || []).length;
    if (n !== want) { console.log(`${page}: expected ${want} match(es) for ${re}, found ${n}; the page changed, update this script`); process.exit(1); }
    html = html.replace(re, to);
  }
  return [page, html];
});
for (const [page, html] of out) writeFileSync(page, html);
console.log(`ok: website/index.html and docs.html name ${v.tag} (${v.size}, released ${released}) and links ${v.url}`);
'
