#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { convertSiteToMarkdown } from "./convert.js";

function printHelp(): void {
  console.error(`Usage:
  npx @humaner/into-markdown <url> > documentation/site.md
  npx @humaner/into-markdown <url> -o documentation/site.md

Options:
  -o, --output <file>  Write markdown to a file (creates parent dirs)
  -h, --help           Show help

Progress goes to stderr; markdown goes to stdout when -o is omitted.`);
}

function parseArgs(argv: string[]): {
  url: string | null;
  output: string | null;
  help: boolean;
} {
  let url: string | null = null;
  let output: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing file path after -o/--output");
      }
      output = next;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (url) {
      throw new Error("Only one URL is supported");
    }
    url = arg;
  }

  return { url, output, help };
}

async function main(): Promise<void> {
  const { url, output, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    return;
  }

  if (!url) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  console.error(`Crawling ${url} …`);
  const result = await convertSiteToMarkdown(url);
  console.error(
    `Done — ${result.pageCount} page(s) → ${result.filename} (${result.markdown.length} chars)`,
  );

  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, result.markdown, "utf8");
    console.error(`Wrote ${output}`);
    return;
  }

  process.stdout.write(result.markdown);
  if (!result.markdown.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
