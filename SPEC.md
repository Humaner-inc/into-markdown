# Into Markdown — Package Spec

This document defines the **public API contract** for `@humaner/into-markdown` package.
Maintainers: changes that follow this spec should pass `npm run validate` and
`npm run build`.

---

## 1. Repository layout

```text
into-markdown/
├── src/                 # crawl library source
│   ├── index.ts         # public exports
│   ├── cli.ts           # npx / into-markdown binary
│   ├── convert.ts       # convertSiteToMarkdown()
│   ├── discover.ts
│   ├── fetch-page.ts
│   ├── browser-fetch.ts
│   ├── html-to-markdown.ts
│   ├── chunk-markdown.ts
│   ├── content-quality.ts
│   ├── categorize.ts
│   ├── assemble.ts
│   ├── public-url.ts
│   ├── url.ts
│   ├── rate-limit.ts
│   └── types.ts
├── eng/
│   ├── build.js
│   └── validate.js
└── dist/
```

This repo is the npm package only, no UI environment included, everything runs locally. 
CLI binary: `into-markdown`
(`npx @humaner/into-markdown`). Usage patterns: [`README.md`](./README.md).

---

## 2. Public API

```ts
import {
  convertSiteToMarkdown,
  MAX_CRAWL_PAGES,
  type ConvertResult,
  type PageCategory,
} from "@humaner/into-markdown";

const result = await convertSiteToMarkdown("https://example.com");
```

### `convertSiteToMarkdown(inputUrl: string): Promise<ConvertResult>`

Crawls the site (sitemap + same-host BFS), converts pages to markdown, and
assembles everything into a single markdown file.

### `ConvertResult`

| Field | Type | Description |
| --- | --- | --- |
| `markdown` | `string` | Assembled `.md` document |
| `rootUrl` | `string` | Normalized crawl root |
| `siteName` | `string` | Derived site name |
| `pageCount` | `number` | Pages included |
| `categories` | `{ name: PageCategory; count: number }[]` | Category breakdown |
| `pages` | `{ url, title, category }[]` | Page index |
| `filename` | `string` | Suggested download filename |

### Limits (documented constants in `types.ts`)

- Max 50 pages per crawl (`MAX_CRAWL_PAGES`)
- ~5 minute wall clock
- Same host only
- Public pages only (SSRF guard in `public-url.ts`)

### Documentation pages

Code samples are kept on documentation pages and dropped elsewhere. A page
counts as documentation when any of these is true:

- Path contains `/docs`, `/help`, `/support`, `/guides`, `/api`, `/reference`, `/developers`, `/handbook`, or `/kb`
- Host starts with `docs.`, `help.`, `support.`, `developers.`, `api.`, `guides.`, or `learn.` (e.g. `docs.markdown.io`, `help.acme.com`)
- The crawl root itself is a documentation host or path — then every page in that crawl keeps code

---

## 3. Validation

`eng/validate.js` checks:

1. Required source files and docs exist
2. TypeScript typechecks with `tsc --noEmit`

---

## 4. Build

`eng/build.js` compiles `src/` → `dist/` with declarations.

Consumers depend on this package. `dist/` is never committed.
