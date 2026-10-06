// Runs the local API (Node + PGlite) and the Next.js dev server side by side.
// Cross-platform replacement for `a & b`, which doesn't work in cmd.exe.
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "--workspace", "@smp/api"]],
  ["web", ["run", "dev", "--workspace", "@smp/web"]],
].map(([name, args]) => {
  const child = spawn("npm", args, { stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}`);
    for (const p of procs) if (p !== child) p.kill();
    process.exit(code ?? 0);
  });
  return child;
});

process.on("SIGINT", () => procs.forEach((p) => p.kill("SIGINT")));
