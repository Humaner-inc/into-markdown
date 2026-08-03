#!/usr/bin/env node
// Compiles src/ → dist/ via TypeScript. Zero runtime deps beyond tsc.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");

if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true });
}

const result = spawnSync(process.execPath, [tsc, "-p", join(ROOT, "tsconfig.json")], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("✓ built dist/ from src/");
