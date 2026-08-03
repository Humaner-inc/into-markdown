#!/usr/bin/env node
// Validates package surface: required source files + TypeScript typecheck.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const REQUIRED = [
  "src/index.ts",
  "src/convert.ts",
  "src/types.ts",
  "src/discover.ts",
  "src/html-to-markdown.ts",
  "src/assemble.ts",
  "SPEC.md",
  "README.md",
  "LICENSE",
];

let failed = false;

for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) {
    console.error(`✗ missing required file: ${rel}`);
    failed = true;
  }
}

const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) {
  console.error("✗ typescript not installed — run npm install");
  failed = true;
} else {
  const result = spawnSync(
    process.execPath,
    [tsc, "-p", join(ROOT, "tsconfig.json"), "--noEmit"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("✓ validate passed");
