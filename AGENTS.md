# AGENTS.md

## Project overview

`@humaner/into-markdown` is a zero-framework crawl library: website URL in,
one markdown knowledge document out. Plain TypeScript + Cheerio + Turndown +
Playwright. No API key needed.

## Repository structure

```text
.
├── src/          # library source (public API: convertSiteToMarkdown)
├── eng/          # build.js / validate.js
├── SPEC.md       # API contract — read this first
└── dist/         # generated — not committed
```

## Setup

```bash
npm install
npm run setup:browser
npm run validate
npm run build
```

## Do not

- Do not weaken the SSRF guard in `src/public-url.ts`.
