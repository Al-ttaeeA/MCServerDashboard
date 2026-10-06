/**
 * Regenerates the metric catalog table in docs/awards.md from the code, so
 * the documented formulas can never drift from what actually runs.
 *
 *   npm run docs:awards
 */
import { readFileSync, writeFileSync } from "node:fs";
import { META_METRICS, METRICS } from "../packages/core/src/index";

const DOC = new URL("../docs/awards.md", import.meta.url);
const START = "<!-- catalog:start -->";
const END = "<!-- catalog:end -->";

const all = [...METRICS, ...META_METRICS];
const families = [...new Set(all.map((m) => m.family))];
const esc = (s: string) => s.replace(/\|/g, "\\|");

let table = `${all.length} metrics, ${all.reduce((n, m) => n + (m.high ? 1 : 0) + (m.low ? 1 : 0), 0)} award titles.\n`;
for (const family of families) {
  table += `\n#### ${family[0]!.toUpperCase()}${family.slice(1)}\n\n`;
  table += "| Metric | Award (high) | Award (low) | Source | Formula | Min. sample | Transform |\n|---|---|---|---|---|---|---|\n";
  for (const m of all.filter((x) => x.family === family)) {
    const hi = m.high ? `${m.high.emoji} ${m.high.title}` : "—";
    const lo = m.low ? `${m.low.emoji} ${m.low.title}` : "—";
    const sens = m.sensitive ? ` *(${m.sensitive})*` : "";
    table += `| \`${m.id}\`${sens} | ${esc(hi)} | ${esc(lo)} | ${m.source} | ${esc(m.formula)} | ${m.minSample} | ${m.transform} |\n`;
  }
}

const doc = readFileSync(DOC, "utf8");
const a = doc.indexOf(START);
const b = doc.indexOf(END);
if (a === -1 || b === -1) throw new Error("catalog markers not found in docs/awards.md");
writeFileSync(DOC, doc.slice(0, a + START.length) + "\n" + table + "\n" + doc.slice(b));
console.log(`docs/awards.md: wrote ${all.length} metrics`);
