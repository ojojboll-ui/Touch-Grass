// Builds the phone page from src/page.html with engine.js and the scenes inlined:
//   dist/touch-grass.html  the artifact (content only; claude.ai adds the document shell)
//   ../docs/index.html     a whole document, for GitHub Pages
//     node web/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.join(here, "src", "page.html"), "utf8");
const engine = readFileSync(path.join(here, "engine.js"), "utf8").replace(/\nif \(typeof module[^\n]*\n?$/, "\n");
// the scenes, in the order the picker shows them
const scenes = ["scene-meadow.js", "scene-water.js"].map((f) => readFileSync(path.join(here, "src", f), "utf8")).join("\n\n");
const content = page.replace("/*ENGINE*/", () => engine).replace("/*SCENES*/", () => scenes);

mkdirSync(path.join(here, "dist"), { recursive: true });
writeFileSync(path.join(here, "dist", "touch-grass.html"), content);

const shell = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>\n${content}\n</body></html>\n`;
mkdirSync(path.join(here, "..", "docs"), { recursive: true });
writeFileSync(path.join(here, "..", "docs", "index.html"), shell);
console.log(`built dist/touch-grass.html (${(content.length / 1024).toFixed(0)} KB) and docs/index.html`);
