// Builds the one Three.js file hey-tattle.com loads: only what website/assets/scene.js uses (every THREE.<name>, plus
// RoomEnvironment and mergeVertices), tree-shaken and minified from the `three` devDependency, written to
// website/assets/vendor/three-<version>.<hash>.js. The content hash in the name lets _headers cache it for a year.
// It then points the landing page's import map at it and puts the import map's new hash in the CSP (website/_headers).
// Run after changing scene.js's use of Three.js, or the `three` version:
//   node scripts/vendor-three.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(p, root);
const require = createRequire(import.meta.url);
// three's source modules, not its prebuilt build/three.module.js: they tree-shake (the build barely does), and the
// addons' own `import … from "three"` is aliased to them so the file holds one copy of the library.
const three = new URL("node_modules/three/src/Three.js", root).pathname, addons = (p) => require.resolve(`three/addons/${p}`);
const version = JSON.parse(readFileSync(at("node_modules/three/package.json"), "utf8")).version;

const scene = readFileSync(at("website/assets/scene.js"), "utf8");
const names = [...new Set([...scene.matchAll(/THREE\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
const entry = [
  `export { ${names.join(", ")} } from ${JSON.stringify(three)};`,
  `export { RoomEnvironment } from ${JSON.stringify(addons("environments/RoomEnvironment.js"))};`,
  `export { mergeVertices } from ${JSON.stringify(addons("utils/BufferGeometryUtils.js"))};`,
].join("\n");

const out = await build({
  stdin: { contents: entry, resolveDir: root.pathname, loader: "js" },
  // the license header three's own build carries (its source files do not), with what this file holds
  banner: { js: `/**\n * @license\n * Copyright 2010-2024 Three.js Authors\n * SPDX-License-Identifier: MIT\n *\n * three.js ${version}, only what hey-tattle.com uses, built by scripts/vendor-three.mjs.\n */` },
  alias: { three }, bundle: true, format: "esm", minify: true, target: "es2020", legalComments: "inline", write: false, logLevel: "warning",
});
const code = out.outputFiles[0].contents;
const name = `three-${version}.${createHash("sha256").update(code).digest("hex").slice(0, 10)}.js`;

const dir = at("website/assets/vendor/");
mkdirSync(dir, { recursive: true });
for (const old of readdirSync(dir)) if (/^three-.*\.js$/.test(old) && old !== name) rmSync(new URL(old, dir));
writeFileSync(new URL(name, dir), code);

// The import map: every specifier scene.js imports resolves to the one file.
const file = `/assets/vendor/${name}`;
const map = `\n{ "imports": {\n  "three": "${file}",\n  "three/addons/environments/RoomEnvironment.js": "${file}",\n  "three/addons/utils/BufferGeometryUtils.js": "${file}"\n} }\n`;
const sha = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
let page = readFileSync(at("website/index.html"), "utf8");
const old = page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
page = page.replace(`<script type="importmap">${old}</script>`, `<script type="importmap">${map}</script>`);
writeFileSync(at("website/index.html"), page);
const headers = readFileSync(at("website/_headers"), "utf8");
if (!headers.includes(sha(old))) throw new Error("website/_headers does not hold the old import map's hash: fix it by hand first");
writeFileSync(at("website/_headers"), headers.replace(sha(old), sha(map)));

console.log(`wrote website/assets/vendor/${name} (${(code.length / 1024).toFixed(0)} KiB, ${names.length} names), the import map, and its CSP hash`);
