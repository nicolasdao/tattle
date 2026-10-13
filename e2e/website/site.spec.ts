// hey-tattle.com in a real browser: the 3D record key rests when nobody is around, headless and software-GL browsers get
// the CSS key, the key's button is named by the words it shows, the footer's links are full-size targets, the docs'
// contents list never makes the page jump, and nothing runs off a phone screen. Offline: website/ is served from disk
// (Three.js included, vendored in assets/vendor/), and GitHub's API is refused.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SITE = join(ROOT, "website");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

let server: Server;
let base = "";
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    let file = join(SITE, pathname === "/" ? "index.html" : pathname === "/docs" ? "docs.html" : pathname);
    if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

// Software WebGL (SwiftShader), the renderer a headless crawler or a GPU-less machine has.
test.use({ launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

async function offline(page: Page) {
  await page.route(/api\.github\.com|cloudflareinsights/, (route) => route.abort());
}

/** Counts animation frames the page asks for, from before its own scripts run. */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as unknown as { frames: number }).frames = 0;
    window.requestAnimationFrame = (cb) => { (window as unknown as { frames: number }).frames++; return raf(cb); };
  });
}
const frames = (page: Page) => page.evaluate(() => (window as unknown as { frames: number }).frames);
/** Looks like a visitor's browser rather than an automated one. */
const notAutomated = (page: Page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));

test("an automated browser gets the CSS key and never loads the 3D scene", async ({ page }) => {
  await offline(page);
  const scene = page.waitForRequest(/scene\.js/, { timeout: 3000 }).then(() => true, () => false);
  await page.goto(base + "/");
  await expect(page.locator("#csskey")).toBeVisible();
  expect(await scene).toBe(false);
});

test("a visitor's browser with only software WebGL gets the CSS key", async ({ page }) => {
  await notAutomated(page);
  await offline(page);
  await page.goto(base + "/");
  await expect(page.locator("#csskey")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bnogl\b/);
});

test("the 3D key stops drawing once nobody has moved for a while, and wakes when someone does", async ({ page }) => {
  test.setTimeout(60_000);
  await notAutomated(page);
  await countFrames(page);
  await offline(page);
  const loaded: string[] = [];
  page.on("requestfinished", (r) => loaded.push(r.url()));
  await page.goto(base + "/?gl"); // ?gl: WebGL even on a software renderer, so this machine can run the scene
  await expect(page.locator("#csskey")).toBeHidden();
  await expect.poll(() => loaded.some((u) => u.startsWith(`${base}/assets/vendor/three-`))).toBe(true); // three.js from the site
  expect(loaded.filter((u) => !u.startsWith(base))).toEqual([]); // and nothing from a CDN
  await expect.poll(() => frames(page), { timeout: 15_000 }).toBeGreaterThan(5); // the scene is drawing
  await page.waitForTimeout(14_000); // 9 s of rest, plus the last idle ring fading out (3.6 s)
  const before = await frames(page);
  await page.waitForTimeout(2_000);
  expect(await frames(page)).toBe(before);
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 310);
  await expect.poll(() => frames(page), { timeout: 5_000 }).toBeGreaterThan(before);
});

test("the record key's button is named by the words it shows, off air and on air", async ({ page }) => {
  await offline(page);
  await page.goto(base + "/?nogl");
  const rec = page.locator("#rec");
  // Every word on the button (both lines, as rendered) is in its accessible name, so voice control finds it.
  const check = async () => {
    const shown = (await rec.innerText()).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const name = ((await rec.ariaSnapshot()).match(/button "([^"]*)"/)?.[1] ?? "").toLowerCase(); // the name the browser computes
    expect(shown.length).toBeGreaterThan(2);
    for (const word of shown) expect(name, word).toContain(word);
    await expect(rec).toHaveAccessibleName(new RegExp(shown[0]!, "i"));
  };
  await check();
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "true");
  await check();
  await rec.click();
  await check();
});

test("the footer's links are at least 24 px tall and none overlaps another, on a phone and a desktop", async ({ page }) => {
  await offline(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base + "/?nogl");
    const rects = await page.locator("footer .fine-links a").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(rects.length).toBeGreaterThan(5);
    for (const r of rects) expect(r.height, `${width}px`).toBeGreaterThanOrEqual(24);
    for (const [i, a] of rects.entries())
      for (const b of rects.slice(i + 1))
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${width}px: overlap`).toBe(true);
  }
});

test("the docs' contents list is open on a desktop and folded on a phone before the page's scripts run, so nothing jumps", async ({ page }) => {
  await offline(page);
  await page.route(/assets\/docs\.js$/, (route) => route.abort()); // as if docs.js were slow to arrive
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(base + "/docs");
  await expect(page.locator("#toc")).not.toHaveAttribute("open", "");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/docs");
  await expect(page.locator("#toc")).toHaveAttribute("open", "");
});

test("on a phone, no text on either page runs off the screen (tables and code scroll on their own)", async ({ page }) => {
  await offline(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/?nogl", "/docs"]) {
    await page.goto(base + path);
    const clipped = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const scrolls = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement)
          if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return true;
        return false;
      };
      return [...document.querySelectorAll("main *, header *")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > W + 1 && !scrolls(el); })
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}: ${el.textContent!.trim().slice(0, 50)}`);
    });
    expect(clipped, path).toEqual([]);
  }
});

test("three.js is preloaded alongside the 3D scene, and never fetched for the CSS key", async ({ page }) => {
  await offline(page);
  const three: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/assets/vendor/three-")) three.push(r.url()); });
  await page.goto(base + "/"); // automated: the CSS key
  await expect(page.locator("#csskey")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(three).toEqual([]);
  await expect(page.locator('link[rel="modulepreload"]')).toHaveCount(0);

  await notAutomated(page);
  await page.goto(base + "/?gl");
  await expect(page.locator('link[rel="modulepreload"]')).toHaveAttribute("href", /\/assets\/vendor\/three-[\d.]+\.[0-9a-f]{10}\.js$/);
  await expect.poll(() => three.length).toBeGreaterThan(0);
});

test("animations below the fold wait until their section scrolls into view, then run", async ({ page }) => {
  await offline(page);
  await page.goto(base + "/?nogl");
  const states = (sel: string) => page.locator(sel).first().evaluate((el) => el.getAnimations({ subtree: true }).map((a) => a.playState));
  await expect.poll(() => states(".signoff-mark")).toEqual(["paused"]); // the sign-off is far down the page
  await expect.poll(() => states(".cue-arrow")).toEqual(["running"]); // the hero's own loops run
  await page.locator(".signoff-mark").scrollIntoViewIfNeeded();
  await expect.poll(() => states(".signoff-mark")).toEqual(["running"]);
  await expect.poll(() => states(".meter")).toEqual(["paused"]); // the rundown's meters, now far above
  await page.locator(".meter").first().scrollIntoViewIfNeeded();
  await expect.poll(() => states(".meter")).toEqual(["running"]);
});

test("the record button sits on the key, and the header's playhead has a tick per section", async ({ page }) => {
  await offline(page);
  await page.goto(base + "/?nogl");
  const box = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON());
  await expect.poll(async () => {
    const [rec, key] = [await box("#rec"), await box("#csskey")];
    return Math.abs(rec.x - key.x) < 2 && Math.abs(rec.y - key.y) < 2 && Math.abs(rec.width - key.width) < 2;
  }).toBe(true);
  const sections = await page.locator("#bar .tabs a[href^='#']").count();
  await expect(page.locator("#bar-track b")).toHaveCount(sections);
});

// Barlow arrives after the first paint (font-display: swap). The fallback faces in theme.css are Arial resized to
// Barlow's widths, so the swap must not move anything: the layout with only the fallback equals the one with Barlow.
for (const [path, marks] of [
  ["/?nogl", ["#cue", ".hero .dl", ".hero .dl-other", "#rec", "#rundown"]],
  ["/docs", [".dhead-row", "main.read", "#start h2"]],
] as const) {
  for (const width of [390, 412, 1440]) { // 412: the phone Lighthouse emulates
    test(`${path} at ${width} px does not move when its web fonts arrive`, async ({ page, browser }) => {
      await offline(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + path);
      const arial = await page.evaluate(async () => {
        const f = new FontFace("probe", 'local("Arial"), local("ArialMT"), local("Liberation Sans")');
        try { await f.load(); return true; } catch { return false; }
      });
      test.skip(!arial, "neither Arial nor Liberation Sans on this machine: the fallback faces cannot apply");
      // measured once the page has settled: its fonts are in (or failed), and a frame has passed for the observers
      const tops = (p: typeof page) => p.evaluate(async (sels) => {
        await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return sels.map((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().top + scrollY));
      }, [...marks]);
      const withBarlow = await tops(page);
      const bare = await browser.newPage({ viewport: { width, height: 900 } });
      await bare.route(/api\.github\.com|cloudflareinsights|\.woff2$/, (route) => route.abort()); // the fallback only
      await bare.goto(base + path);
      const withFallback = await tops(bare);
      await bare.close();
      for (const [i, sel] of marks.entries()) expect(Math.abs(withFallback[i]! - withBarlow[i]!), `${sel}: ${withFallback[i]} vs ${withBarlow[i]}`).toBeLessThanOrEqual(2);
    });
  }
}

test("the record button never jumps into place: it shows only once it sits on the key", async ({ page }) => {
  await offline(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    (window as unknown as { shifts: string[] }).shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { sources: { node?: Node }[] }[])
        for (const s of e.sources) (window as unknown as { shifts: string[] }).shifts.push((s.node as Element)?.id || (s.node as Element)?.className || "?");
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(base + "/?nogl");
  await page.waitForTimeout(1500);
  const shifts = await page.evaluate(() => (window as unknown as { shifts: string[] }).shifts);
  expect(shifts).not.toContain("rec");
});

test("the page knows Mac or not before its scripts run, so the right Download block shows from the first paint", async ({ browser }) => {
  for (const [ua, platform] of [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "mac"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "other"],
  ]) {
    for (const path of ["/?nogl", "/docs"]) {
      const page = await browser.newPage({ userAgent: ua });
      await page.route(/api\.github\.com|cloudflareinsights|download\.js/, (route) => route.abort()); // as if download.js were slow
      await page.goto(base + path);
      await expect(page.locator("html"), `${platform} ${path}`).toHaveAttribute("data-platform", platform);
      await page.close();
    }
  }
});

test("GitHub's API is asked at most once an hour per visitor, and never by automated browsers", async ({ browser }) => {
  const RELEASE = { tag_name: "v9.9.9", html_url: "https://github.com/nicolasdao/tattle/releases/tag/v9.9.9", published_at: "2026-10-13T00:00:00Z",
    assets: [{ name: "Tattle-9.9.9-arm64.dmg", browser_download_url: "https://github.com/nicolasdao/tattle/releases/download/v9.9.9/Tattle-9.9.9-arm64.dmg", size: 150e6 }] };
  const calls: string[] = [];
  const context = await browser.newContext();
  await context.route(/cloudflareinsights/, (route) => route.abort());
  await context.route(/api\.github\.com/, (route) => { calls.push(route.request().url()); return route.fulfill({ json: RELEASE, headers: { "access-control-allow-origin": "*" } }); });

  const bot = await context.newPage(); // Playwright's browser says navigator.webdriver: like a crawler
  await bot.goto(base + "/?nogl");
  await bot.waitForTimeout(800);
  expect(calls).toEqual([]);
  await expect(bot.locator(".hero [data-version]").first()).toHaveText(/^v\d/); // the HTML already names the release
  await bot.close();

  const visitor = await context.newPage();
  await notAutomated(visitor);
  await visitor.goto(base + "/?nogl");
  await expect(visitor.locator(".hero [data-version]").first()).toHaveText("v9.9.9");
  expect(calls).toHaveLength(1);
  await visitor.close();

  const again = await context.newPage(); // a new tab, within the hour: the saved answer, no new call
  await notAutomated(again);
  await again.goto(base + "/docs");
  await expect(again.locator("[data-version]").first()).toHaveText("v9.9.9");
  expect(calls).toHaveLength(1);
  await context.close();
});

// WCAG AA text contrast, as Lighthouse checks it: 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold). Text on a
// gradient or image is skipped (no single background). The demos' verdict lower thirds appear only while they run, so
// one of each is added to the landing page first.
test("all text on both pages has enough contrast against its background", async ({ page }) => {
  await offline(page);
  await page.emulateMedia({ reducedMotion: "reduce" }); // the demos at rest, not caught mid-fade
  for (const path of ["/?nogl", "/docs"]) {
    await page.goto(base + path);
    if (path !== "/docs") await page.evaluate(() => {
      const box = document.createElement("div");
      box.innerHTML = ["supported", "contradicted", "misleading", "unverifiable"].map((v) =>
        `<div class="fc v-${v}"><div class="fc-verdict"><span class="vw">${v}</span><span class="vm">High confidence</span></div></div>`).join("");
      document.querySelector("#systems")!.append(box);
    });
    const failures = await page.evaluate(() => {
      const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]) => [r!, g!, b!].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
        .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0);
      const out: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode()); ) {
        const el = n.parentElement!; if (!n.textContent!.trim()) continue;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (r.width === 0 || cs.visibility === "hidden" || el.closest("[hidden], script, style, noscript, .csskey, .caps, .lower")) continue;
        let bg: number[] | null = null, alpha = 1;
        for (let p: Element | null = el; p; p = p.parentElement) {
          const ps = getComputedStyle(p); alpha *= Number(ps.opacity);
          if (ps.backgroundImage !== "none") { bg = null; break; }
          const c = rgba(ps.backgroundColor); if ((c[3] ?? 1) === 1) { bg = c; break; }
          if ((c[3] ?? 1) > 0) { bg = null; break; } // translucent: skip, as axe reports it "incomplete"
        }
        if (!bg) continue;
        const fg = rgba(cs.color); const a = (fg[3] ?? 1) * alpha;
        if (alpha < 0.1) continue; // not shown (an inactive label at opacity 0)
        if ((fg[3] ?? 1) === 0 && cs.webkitTextStroke !== "0px") continue; // outlined letters: read by their stroke
        const mix = [0, 1, 2].map((i) => fg[i]! * a + bg![i]! * (1 - a));
        const [hi, lo] = [lum(mix), lum(bg)].sort((x, y) => y - x);
        const ratio = (hi! + 0.05) / (lo! + 0.05), size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (ratio < need - 0.005) out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.textContent!.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
      }
      return [...new Set(out)];
    });
    expect(failures, path).toEqual([]);
  }
});
