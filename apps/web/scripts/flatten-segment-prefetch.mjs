// Post-build fix for the static export.
//
// For nested routes, `next build` writes segment-prefetch payloads into
// folders (out/leaderboards/__next.leaderboards/__PAGE__.txt), but the
// client router requests them with dots
// (/leaderboards/__next.leaderboards.__PAGE__.txt). A plain static host
// returns 404, so prefetching silently falls back to slower navigation.
// We add a copy of each file under the dotted name the router asks for.
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
let copied = 0;

function flatten(segmentDir, prefix, parent) {
  for (const name of readdirSync(segmentDir)) {
    const full = join(segmentDir, name);
    if (statSync(full).isDirectory()) flatten(full, `${prefix}.${name}`, parent);
    else {
      const target = join(parent, `${prefix}.${name}`);
      if (!existsSync(target)) {
        copyFileSync(full, target);
        copied++;
      }
    }
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) flatten(full, name, dir);
    else if (name !== "_next") walk(full);
  }
}

if (!existsSync(OUT)) {
  console.error("flatten-segment-prefetch: out/ not found — run next build first");
  process.exit(1);
}
walk(OUT);
console.log(`flatten-segment-prefetch: added ${copied} prefetch file alias(es)`);
