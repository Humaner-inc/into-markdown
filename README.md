# @humaner/into-markdown

**Crawl a website. Get one clean markdown file for your agent knowledge source.** No API needed.

```bash
npm install @humaner/into-markdown
npx playwright install chromium
```

## CLI : Render the .md summary into `/documentation` - you must create the folder first

```bash
npx @humaner/into-markdown https://example.com > documentation/site.md
```

## Optional UI

This repo only include the npm package and do not include any UI evironment. 
**https://markdown.humaner.io** remains the property of Humaner.
If you want to do-so you must create your own environement.

```ts
import { convertSiteToMarkdown } from "@humaner/into-markdown";

const result = await convertSiteToMarkdown("https://example.com");

```

## How it works

1. Discover pages from `sitemap.xml` and same-host links (BFS), up to 50 pages
2. Fetch each page over HTTP
3. If the HTML looks like a JS shell, render it in headless Chromium (Playwright)
4. Strip site chrome (nav, footer, sidebar, cookies, CTAs)
5. Convert to markdown (Turndown + GFM tables)
6. Bucket by path and assemble one `.md` knowledge-base document

## Limits

- Max 50 pages per crawl
- ~5 minute wall clock
- Same host only
- Public pages only (SSRF guard)
- Static HTML stays on the fast path; SPAs use Chromium

## Package surface

See [`SPEC.md`](./SPEC.md) for the API contract.

## Scripts

```bash
npm install
npm run validate
npm run build
npm run setup:browser   # to install Chromium
```

## License

MIT. Issues welcome; PRs aren't accepted for this kind of tool: see [`CONTRIBUTING.md`](./CONTRIBUTING.md).
