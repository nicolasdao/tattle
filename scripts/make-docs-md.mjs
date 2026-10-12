// Writes website/docs.md, the manual (website/docs.html) as plain Markdown for tools and agents that read docs
// (hey-tattle.com/docs.md, linked from /llms.txt). Generated, never edited by hand: tests/website.test.ts fails when it
// is stale. Run after any change to docs.html:
//   node scripts/make-docs-md.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = "https://hey-tattle.com";

const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&");

/** One line of inline HTML as Markdown. */
function inline(html) {
  return decode(html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) =>
      `[${inline(text)}](${href.startsWith("#") ? `${SITE}/docs${href}` : href.startsWith("/") ? SITE + href : href})`)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, "**$2**")
    .replace(/<span class="ui">([\s\S]*?)<\/span>/g, "**$1**") // a label as the app shows it
    .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
    .replace(/<(code|kbd)>([\s\S]*?)<\/\1>/g, "`$2`")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ").trim();
}

function table(html) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => inline(c[2]).replace(/\|/g, "\\|")));
  const [headRow, ...body] = rows;
  return [`| ${headRow.join(" | ")} |`, `|${headRow.map(() => " --- |").join("")}`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function list(html, ordered) {
  return [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m, i) => `${ordered ? `${i + 1}.` : "-"} ${inline(m[1])}`).join("\n");
}

/** The manual as Markdown: its title, lede and date, then every section of <main>. */
export function docsToMarkdown(html) {
  const title = inline(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1]);
  const lede = inline(html.match(/<p class="dlede">([\s\S]*?)<\/p>/)[1]);
  const meta = inline(html.match(/<p class="dmeta">([\s\S]*?)<\/p>/)[1]);
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
  const blocks = [];
  const re = new RegExp([
    /<div class="needs">(?<needs>[\s\S]*?)<\/div>/, /<span class="note-t">(?<note>[\s\S]*?)<\/span>/,
    /<pre><code>(?<pre>[\s\S]*?)<\/code><\/pre>/, /<table>(?<table>[\s\S]*?)<\/table>/,
    /<h2\b[^>]*>(?<h2>[\s\S]*?)<\/h2>/, /<h3\b[^>]*>(?<h3>[\s\S]*?)<\/h3>/,
    /<ul\b[^>]*>(?<ul>[\s\S]*?)<\/ul>/, /<ol\b[^>]*>(?<ol>[\s\S]*?)<\/ol>/,
    /<p\b[^>]*>(?<p>[\s\S]*?)<\/p>/, /<section id="(?<section>[^"]+)"/,
  ].map((r) => r.source).join("|"), "g");
  for (const { groups: g } of main.matchAll(re)) {
    if (g.needs !== undefined) blocks.push(`Needs: ${[...g.needs.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)].map((c) => inline(c[1])).join(" · ")}`);
    else if (g.note !== undefined) blocks.push(`**Note: ${inline(g.note)}.**`);
    else if (g.pre !== undefined) blocks.push("```sh\n" + decode(g.pre) + "\n```");
    else if (g.table !== undefined) blocks.push(table(g.table));
    else if (g.h2 !== undefined) {
      const no = g.h2.match(/<em>([^<]*)<\/em>/)?.[1];
      blocks.push(`## ${no ? `${no}. ` : ""}${inline(g.h2.replace(/<em>[^<]*<\/em>/, ""))}`);
    } else if (g.h3 !== undefined) blocks.push(`### ${inline(g.h3)}`);
    else if (g.ul !== undefined) blocks.push(list(g.ul, false));
    else if (g.ol !== undefined) blocks.push(list(g.ol, true));
    else if (g.p !== undefined) { const p = inline(g.p); if (p) blocks.push(p); }
    else if (g.section !== undefined) blocks.push(`<!-- ${SITE}/docs#${g.section} -->`);
  }
  const body = blocks.join("\n\n").replace(/<!-- (\S+) -->\n\n(## .*)/g, "$2\n\n$1"); // each section's address under its heading
  return `# ${title}\n\n> ${lede}\n\n${meta}\n\nThe web page: ${SITE}/docs\n\n${body}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../website/", import.meta.url);
  writeFileSync(new URL("docs.md", root), docsToMarkdown(readFileSync(new URL("docs.html", root), "utf8")));
  console.log("wrote website/docs.md");
}
