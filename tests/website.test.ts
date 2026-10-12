import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// hey-tattle.com (website/): what search engines and link previews read, and the two things a change to the page can
// silently break: the release's rewrite of the download fields, and the 3D key's import map under the CSP.
const SITE = "https://hey-tattle.com";
const path = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p: string) => readFileSync(path(p), "utf8");
const page = read("website/index.html");
const head = page.slice(0, page.indexOf("</head>"));

function meta(attr: "name" | "property", key: string): string | undefined {
  return head.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`))?.[1];
}
function links(rel: string): { href: string; tag: string }[] {
  return [...head.matchAll(/<link [^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`rel="${rel}"`))
    .map((tag) => ({ href: tag.match(/href="([^"]*)"/)?.[1] ?? "", tag }));
}
/** The file in website/ that an address on the site serves. */
function served(url: string): string {
  const { pathname } = new URL(url, `${SITE}/`);
  return `website${pathname}`;
}
function imageSize(buf: Buffer): { type: string; width: number; height: number } {
  if (buf.subarray(1, 4).toString("latin1") === "PNG") return { type: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length; ) {
      const marker = buf[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xc3) return { type: "image/jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error("not a PNG or JPEG");
}
/** Whether website/.assetsignore keeps a file off the site. */
function ignored(file: string): boolean {
  const rel = file.replace(/^website\//, "");
  return read("website/.assetsignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).some((p) =>
    p.endsWith("/") ? rel.startsWith(p) : p.startsWith("*.") ? rel.endsWith(p.slice(1)) : rel === p);
}
function jsonLd(): Record<string, any>[] {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
  return blocks.flatMap((b) => b["@graph"] ?? [b]);
}

describe("the page's head", () => {
  it("names one canonical address, with a title and description short enough to show whole in search results", () => {
    expect(links("canonical").map((l) => l.href)).toEqual([`${SITE}/`]);
    const title = head.match(/<title>([^<]*)<\/title>/)![1]!;
    expect(title).toMatch(/^Tattle\b/);
    expect(title.length).toBeLessThanOrEqual(60);
    const description = meta("name", "description")!;
    expect(description.length).toBeGreaterThanOrEqual(110);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("gives link previews a title, description, address, site name, and an image with its size and alt text", () => {
    expect(meta("property", "og:type")).toBe("website");
    expect(meta("property", "og:url")).toBe(`${SITE}/`);
    expect(meta("property", "og:site_name")).toBe("Tattle");
    expect(meta("property", "og:title")).toMatch(/^Tattle\b/);
    expect(meta("property", "og:description")!.length).toBeGreaterThan(50);
    const image = meta("property", "og:image")!;
    expect(image.startsWith(`${SITE}/`)).toBe(true);
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
    expect(meta("property", "og:image:alt")!.length).toBeGreaterThan(20);
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:image")).toBe(image);
    expect(meta("name", "twitter:image:alt")).toBe(meta("property", "og:image:alt"));
  });

  it("serves the preview image at 1200×630, in the type it declares, under 300 KB so chat apps still show it", () => {
    const file = served(meta("property", "og:image")!);
    expect(existsSync(path(file))).toBe(true);
    expect(ignored(file)).toBe(false);
    const size = imageSize(readFileSync(path(file)));
    expect(size).toEqual({ type: meta("property", "og:image:type"), width: 1200, height: 630 });
    expect(statSync(path(file)).size).toBeLessThan(300_000);
  });

  it("links its icons as files a search engine can fetch, not data: addresses", () => {
    const icons = [...links("icon"), ...links("apple-touch-icon")];
    expect(icons.map((i) => i.href).sort()).toEqual(["/apple-touch-icon.png", "/favicon.ico", "/favicon.svg"]);
    for (const { href } of icons) {
      expect(existsSync(path(served(href))), href).toBe(true);
      expect(ignored(served(href)), href).toBe(false);
    }
    expect(imageSize(readFileSync(path("website/apple-touch-icon.png")))).toEqual({ type: "image/png", width: 180, height: 180 });
    const ico = readFileSync(path("website/favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // an icon resource
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 48]));
  });

  it("has one h1, and it says what the app does rather than only its name", () => {
    const h1s = [...page.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toMatch(/transcribes/);
    expect(h1s[0]).toMatch(/fact-checks/);
  });
});

describe("crawling", () => {
  it("robots.txt lets every crawler in and names the sitemap, which lists the canonical page", () => {
    const robots = read("website/robots.txt");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, "m"));
    const locs = [...read("website/sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs[0]).toBe(links("canonical")[0]!.href);
    expect(ignored("website/robots.txt") || ignored("website/sitemap.xml")).toBe(false);
  });
});

describe("structured data", () => {
  it("describes the site, the app, and its publisher, with the preview image and no invalid properties", () => {
    const nodes = jsonLd();
    const site = nodes.find((n) => n["@type"] === "WebSite")!;
    expect(site).toMatchObject({ name: "Tattle", url: `${SITE}/` });
    const app = nodes.find((n) => n["@type"] === "SoftwareApplication")!;
    expect(app).toMatchObject({ name: "Tattle", url: `${SITE}/`, image: meta("property", "og:image"), isAccessibleForFree: true });
    expect(app.offers).toMatchObject({ price: "0" });
    expect(app.featureList.length).toBeGreaterThan(3);
    expect(app).not.toHaveProperty("codeRepository"); // a SoftwareSourceCode property; the repository goes in sameAs
    expect(app.sameAs).toContain("https://github.com/nicolasdao/tattle");
    const publisher = nodes.find((n) => n["@type"] === "Organization")!;
    expect(publisher).toMatchObject({ name: "Cloudless Labs", url: "https://cloudlesslabs.com" });
    expect(app.publisher).toEqual({ "@id": publisher["@id"] });
  });
});

describe("the docs page, /docs", () => {
  const docs = existsSync(path("website/docs.html")) ? read("website/docs.html") : ""; // a missing page fails each test, not the file
  const docsHead = docs.slice(0, docs.indexOf("</head>"));
  const docsMeta = (attr: "name" | "property", key: string) =>
    docsHead.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`))?.[1];
  const text = docs.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const ids = new Set([...docs.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

  it("is a page of its own, with its own canonical address, title, description, and link preview", () => {
    expect(docsHead).toContain(`<link rel="canonical" href="${SITE}/docs">`);
    const title = docsHead.match(/<title>([^<]*)<\/title>/)![1]!;
    expect(title).toMatch(/^Tattle\b/);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(docsMeta("name", "description")!.length).toBeGreaterThanOrEqual(110);
    expect(docsMeta("name", "description")!.length).toBeLessThanOrEqual(160);
    expect(docsMeta("property", "og:url")).toBe(`${SITE}/docs`);
    expect(docsMeta("property", "og:image")).toBe(meta("property", "og:image"));
    expect(docsMeta("name", "twitter:card")).toBe("summary_large_image");
    expect([...docs.matchAll(/<h1\b/g)]).toHaveLength(1);
  });

  it("is linked from the landing page's header bar, hero, and footer, and listed in the sitemap", () => {
    const bar = page.match(/<div class="bar" id="bar">[\s\S]*?<div class="bar-track"/)![0];
    const hero = page.match(/<header class="hero"[\s\S]*?<\/header>/)![0];
    const footer = page.match(/<footer[\s\S]*?<\/footer>/)![0];
    for (const part of [bar, hero, footer]) expect(part).toContain('href="/docs"');
    const locs = [...read("website/sitemap.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toContain(`${SITE}/docs`);
  });

  it("has a contents list that reaches every section, and every in-page link lands somewhere", () => {
    const sections = [...docs.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    const toc = docs.match(/<details class="toc"[\s\S]*?<\/details>/)![0];
    expect(sections.length).toBeGreaterThan(15);
    for (const id of sections) expect(toc, id).toContain(`href="#${id}"`);
    for (const [, id] of docs.matchAll(/href="#([^"]+)"/g)) expect(ids.has(id), `#${id}`).toBe(true);
  });

  it("covers every part of the app", () => {
    const topics = [
      "start", "install", "permissions", "keys", "transcription", "session", "header", "transcript", "speakers", "timeline",
      "fact-checking", "thinking", "jev-log", "insights", "label-sets", "create-with-ai", "try-a-set", "chat", "recordings",
      "playback", "replay", "export-import", "costs", "privacy", "files", "updates", "menus", "shortcuts", "links",
      "show-checklist", "troubleshooting", "limits", "developers", "help",
    ];
    for (const id of topics) expect(ids.has(id), `#${id}`).toBe(true);
  });

  it("names every menu item the Mac app adds, every verdict, and every Chat model, as the code defines them", () => {
    const menu = [...read("desktop/main.ts").matchAll(/label: "([^"]+)"/g)].map((m) => m[1]!);
    expect(menu.length).toBeGreaterThan(5);
    for (const item of menu) expect(text, item).toContain(item);
    expect(text).toContain("⌘,"); // Settings…, the one accelerator the app sets itself
    const verdicts = read("web/src/panels.ts").match(/const VERDICT_LABEL[^{]*\{([^}]*)\}/)![1]!;
    for (const [, label] of verdicts.matchAll(/: "([^"]+)"/g)) expect(text, label).toContain(label!);
    const models: string[] = JSON.parse(read("config/app.json")).chat.models;
    for (const id of models) expect(text, id).toContain(id);
  });

  it("documents the keyboard shortcuts", () => {
    const shortcuts = docs.match(/<section id="shortcuts"[\s\S]*?<\/section>/)![0];
    for (const key of ["⌘K", "⌘,", "Space", "Esc", "Enter", "Shift", "⌘Q", "⌘W"]) expect(shortcuts, key).toContain(key);
  });

  it("loads only the site's own files, which exist, and no inline script the CSP would block", () => {
    for (const [, src] of docs.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) expect(existsSync(path(`website/${src}`)), src).toBe(true);
    const scripts = [...docs.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    const csp = read("website/_headers").match(/Content-Security-Policy: (.*)/)![1]!;
    for (const [, attrs, body] of scripts) {
      if (!body!.trim() || attrs!.includes('type="application/ld+json"')) continue;
      expect(csp, "an inline script the CSP allows by its hash").toContain(`'sha256-${createHash("sha256").update(body!).digest("base64")}'`);
    }
    expect(docs).toContain('data-download href="https://github.com/nicolasdao/tattle/releases/latest"');
  });
});

describe("who made it", () => {
  const YOUTUBE = "https://www.youtube.com/@nicolasdao";
  const X = "https://x.com/realnicdao";
  const PODCAST = "https://www.youtube.com/@theMadKoo";
  const section = (id: string) => page.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`))![0];
  const anchors = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>/g)].map((m) => ({ href: m[1]!, tag: m[0] }));

  it("the credits link Nicolas's YouTube channel and X, and the podcast Tattle was first demoed on, each in a new tab", () => {
    const links = anchors(section("credits"));
    for (const url of [YOUTUBE, X, PODCAST]) {
      const link = links.find((l) => l.href === url);
      expect(link, url).toBeDefined();
      expect(link!.tag).toContain('target="_blank"');
      expect(link!.tag).toMatch(/rel="[^"]*\bnoopener\b/);
    }
    expect(section("credits")).toMatch(/first demoed/i);
    // his own profiles say they are his (rel="me"); the podcast is a show, not a profile of his
    for (const url of [YOUTUBE, X]) expect(links.find((l) => l.href === url)!.tag).toMatch(/rel="[^"]*\bme\b/);
  });

  it("the footer names them too", () => {
    const footer = page.match(/<footer[\s\S]*?<\/footer>/)![0];
    const hrefs = anchors(footer).map((l) => l.href);
    expect(hrefs).toEqual(expect.arrayContaining([YOUTUBE, X, PODCAST]));
  });

  it("X cards credit @realnicdao, and the structured data ties both profiles to the author", () => {
    expect(meta("name", "twitter:site")).toBe("@realnicdao");
    expect(meta("name", "twitter:creator")).toBe("@realnicdao");
    const app = jsonLd().find((n) => n["@type"] === "SoftwareApplication")!;
    const author = jsonLd().find((n) => n["@id"] === app.author["@id"])!;
    expect(author.sameAs).toEqual(expect.arrayContaining([YOUTUBE, X]));
  });
});

describe("what a change to the page must not break", () => {
  it("the release's update-website.sh still finds each field it rewrites, as many times as it expects", () => {
    const script = read(".agents/skills/release-tattle/scripts/update-website.sh");
    const edits = [...script.matchAll(/^\s*\[\/(.+)\/g, .+, (\d+)\],?$/gm)].map((m) => ({ re: new RegExp(m[1]!, "g"), want: Number(m[2]) }));
    expect(edits.length).toBeGreaterThanOrEqual(10);
    for (const { re, want } of edits) expect((page.match(re) ?? []).length, String(re)).toBe(want);
  });

  it("the Content Security Policy allows the page's import map by its hash, so the 3D key loads", () => {
    const map = page.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]!;
    const hash = `'sha256-${createHash("sha256").update(map).digest("base64")}'`;
    const csp = read("website/_headers").match(/Content-Security-Policy: (.*)/)![1]!;
    expect(csp).toContain(hash);
  });
});

describe("search: the SEO pass of 12 October 2026", () => {
  const PERSON = "https://nicolasdao.com/#nicolas-dao"; // the @id nicolasdao.com publishes
  const ORG = "https://cloudlesslabs.com#org"; // the @id cloudlesslabs.com publishes
  const docs = read("website/docs.html");
  const docsHead = docs.slice(0, docs.indexOf("</head>"));
  const title = (h: string) => h.match(/<title>([^<]*)<\/title>/)![1]!;
  const graph = (html: string): Record<string, any>[] =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => JSON.parse(m[1]!)["@graph"]);
  const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const docIds = new Set([...docs.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const sitemap = read("website/sitemap.xml");

  it("calls the product Tattle for Mac in both titles and link previews, so it stands apart from other Tattles", () => {
    expect(title(head)).toBe("Tattle for Mac: free live transcription and fact-checking");
    expect(title(docsHead)).toBe("Tattle for Mac docs: setup, fact-checking, troubleshooting");
    expect(meta("property", "og:title")).toMatch(/^Tattle for Mac\b/);
    expect(docsHead).toMatch(/<meta property="og:title" content="Tattle for Mac\b/);
  });

  it("says what Tattle for Mac is in one plain sentence under the hero's heading, and the docs say whose it is not", () => {
    const hero = page.match(/<header class="hero"[\s\S]*?<\/header>/)![0];
    expect(textOf(hero)).toContain("Tattle for Mac is a free, open-source app that transcribes your calls and podcasts live");
    expect(textOf(docs)).toContain("Tattle for Mac is not affiliated with Tattle Civic Tech (tattle.co.in) or other apps named Tattle.");
  });

  it("states the limits near the download button: Apple Silicon, English, and the fact-checking key and its cost", () => {
    const dl = textOf(page.match(/<div class="dl" data-when="mac">[\s\S]*?<\/div>/)![0]);
    expect(dl).toContain("Apple Silicon");
    expect(dl).toContain("English");
    expect(dl).toMatch(/OpenRouter key/);
    expect(dl).toContain("$0.35"); // the docs' figure: "Up to about $0.35 an hour"
    expect(textOf(docs)).toContain("Up to about $0.35 an hour");
  });

  it("lets search engines show large image previews of both pages", () => {
    for (const h of [head, docsHead]) expect(h).toContain('<meta name="robots" content="max-image-preview:large">');
  });

  it("names each section of the landing page in its heading, not only with a metaphor", () => {
    const heads = [...page.matchAll(/<section class="sect" id="([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g)];
    expect(heads.length).toBeGreaterThanOrEqual(6);
    for (const [, id, h2] of heads) {
      expect(h2, id).toMatch(/<span class="eyebrow">[^<]+<\/span>/); // the descriptive line is part of the heading
      expect(textOf(h2!).trim().split(" ").length, id).toBeGreaterThanOrEqual(4);
    }
  });

  it("links each landing-page section to the part of the docs that explains it", () => {
    for (const id of ["rundown", "jev", "systems", "labels", "preshow"]) {
      const sect = page.match(new RegExp(`<section class="sect" id="${id}"[\\s\\S]*?</section>`))![0];
      const deep = [...sect.matchAll(/href="\/docs#([^"]+)"/g)].map((m) => m[1]!);
      expect(deep.length, id).toBeGreaterThan(0);
      for (const anchor of deep) expect(docIds.has(anchor), `${id} → /docs#${anchor}`).toBe(true);
    }
  });

  it("ties the app, the docs, the author and the publisher to the @ids their own sites publish", () => {
    const home = graph(page);
    const app = home.find((n) => n["@type"] === "SoftwareApplication")!;
    expect(app["@id"]).toBe(`${SITE}/#app`);
    expect(app.author).toEqual({ "@id": PERSON });
    expect(app.publisher).toEqual({ "@id": ORG });
    const person = home.find((n) => n["@id"] === PERSON)!;
    expect(person).toMatchObject({ "@type": "Person", name: "Nicolas Dao" });
    expect(person.sameAs).toContain("https://github.com/nicolasdao");
    expect(JSON.stringify(home)).not.toContain("linkedin"); // unverified: never list a profile nobody confirmed
    expect(home.find((n) => n["@id"] === ORG)).toMatchObject({ "@type": "Organization", name: "Cloudless Labs" });
    expect(home.some((n) => n["@id"] === "https://cloudlesslabs.com/#organization")).toBe(false);

    const article = graph(docs).find((n) => n["@type"] === "TechArticle")!;
    expect(article).toMatchObject({ author: { "@id": PERSON }, publisher: { "@id": ORG }, about: { "@id": `${SITE}/#app` } });
    for (const id of [PERSON, ORG]) expect(graph(docs).some((n) => n["@id"] === id), id).toBe(true);
  });

  it("gives the app's markup the version, size and release notes the page shows", () => {
    const app = graph(page).find((n) => n["@type"] === "SoftwareApplication")!;
    expect(`v${app.softwareVersion}`).toBe(page.match(/<span data-version>([^<]*)</)![1]);
    expect(app.fileSize).toBe(page.match(/<span data-size>([^<]*)</)![1]);
    expect(app.releaseNotes).toBe(page.match(/data-notes href="([^"]*)"/)![1]);
    expect(app.downloadUrl).toBe(page.match(/data-download href="([^"]*)"/)![1]);
  });

  it("dates the docs, visibly and in the markup, and the sitemap gives each page its last change", () => {
    const article = graph(docs).find((n) => n["@type"] === "TechArticle")!;
    expect(article.datePublished).toBe("2026-09-30");
    const shown = docs.match(/Last updated <time datetime="(\d{4}-\d{2}-\d{2})">/)?.[1];
    expect(shown).toBeDefined();
    expect(article.dateModified).toBe(shown);
    expect(article.dateModified >= article.datePublished).toBe(true);
    const urls = [...sitemap.matchAll(/<url><loc>([^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)].map((m) => [m[1], m[2]]);
    expect(urls.map((u) => u[0])).toEqual([`${SITE}/`, `${SITE}/docs`]);
    expect(Object.fromEntries(urls)[`${SITE}/docs`]).toBe(article.dateModified);
  });

  it("moves the pages' other addresses permanently (301), not temporarily", () => {
    const rules = read("website/_redirects").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim().split(/\s+/));
    expect(rules).toEqual(expect.arrayContaining([["/index.html", "/", "301"], ["/docs.html", "/docs", "301"], ["/docs/", "/docs", "301"]]));
    expect(ignored("website/_redirects")).toBe(false);
  });

  it("has an llms.txt with plain facts and links that land, kept out of the sitemap", () => {
    const llms = read("website/llms.txt");
    expect(llms).toMatch(/^# Tattle for Mac\n\n> .+\n/);
    const urls = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(8);
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\/(hey-tattle\.com|github\.com\/nicolasdao\/tattle)\b/);
      const anchor = url.match(/^https:\/\/hey-tattle\.com\/docs#(.+)$/)?.[1];
      if (anchor) expect(docIds.has(anchor), url).toBe(true);
    }
    expect(llms).toContain(`${SITE}/docs.md`);
    expect(ignored("website/llms.txt")).toBe(false);
    expect(sitemap).not.toContain("llms.txt");
  });

  it("serves the docs as Markdown at /docs.md, generated from docs.html so it never drifts", async () => {
    const { docsToMarkdown } = await import("../scripts/make-docs-md.mjs");
    expect(read("website/docs.md")).toBe(docsToMarkdown(docs));
    expect(ignored("website/docs.md")).toBe(false);
    expect(read("website/_headers")).toMatch(/^\/docs\.md\n\s+Content-Type: text\/markdown; charset=utf-8$/m);
    // the Markdown copy points search engines at the page, so the two never compete
    expect(read("website/_headers")).toMatch(/^\/docs\.md\n(\s+.+\n)*\s+Link: <https:\/\/hey-tattle\.com\/docs>; rel="canonical"$/m);
    const md = read("website/docs.md");
    expect(md).toMatch(/^# How to use Tattle\n/);
    for (const label of ["Supported", "False", "Misleading"]) expect(md).toContain(label);
    expect(md).toContain("Needs: OpenRouter key · Up to about $0.35 an hour");
    expect(md.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "")).not.toMatch(/<[a-z][^>]*>/); // no HTML left over, outside code
  });

  it("keeps a space between each docs section's number and its name, so they read as two words", () => {
    const h2s = [...docs.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "")); // the text as a crawler joins it
    expect(h2s.length).toBeGreaterThan(25);
    for (const h of h2s) expect(h, h).toMatch(/^\s*\d{2} \S/);
    for (const [, a] of docs.matchAll(/<a href="#[^"]+">(<em>\d{2}<\/em>[^<]*)<\/a>/g)) expect(a, a).toMatch(/<\/em> \S/);
  });

  it("gives every docs table its header cells, and the footer links a 24 px target", () => {
    for (const [table] of docs.matchAll(/<table>[\s\S]*?<\/table>/g)) expect(table).toMatch(/<th scope="(col|row)">/);
    expect(read("website/assets/style.css")).toMatch(/\.fine-links a \{[^}]*min-height: 24px/);
  });
});
