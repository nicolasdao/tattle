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
