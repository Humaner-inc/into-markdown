import { categorizeUrl } from "./categorize.js";
import { extractLinks } from "./html-to-markdown.js";
import { fetchText, loadPageHtml, mapPool } from "./fetch-page.js";
import {
  BROWSER_CONCURRENCY,
  MAX_CRAWL_MS,
  MAX_CRAWL_PAGES,
  type PageCategory,
} from "./types.js";
import {
  isUtilityPath,
  normalizePageUrl,
  normalizeRootUrl,
  normalizeSitemapUrl,
} from "./url.js";

/** Sitemap entries to read before ranking, so a subtree crawl can find its pages. */
const SITEMAP_SCAN_LIMIT = 2_000;
const MAX_SITEMAPS = 20;

/** On a whole-site crawl, heavy sections may not consume the entire budget. */
const BLOG_BUDGET_RATIO = 0.2;
const DOCS_BUDGET_RATIO = 0.3;
const OTHER_BUDGET_RATIO = 0.15;
const PREFIX_BUDGET_RATIO = 0.35;

const CATEGORY_SCORE: Record<PageCategory, number> = {
  Home: 0,
  Pricing: 1,
  Product: 2,
  Legal: 3,
  Company: 4,
  Careers: 5,
  Docs: 6,
  Other: 7,
  Blog: 8,
};

function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function pathPrefix(root: URL): string {
  const path = root.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** Crawling https://site.com/docs means the docs subtree, not the whole site. */
function isUnderPrefix(url: string, prefix: string): boolean {
  if (prefix === "/") return true;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return path === prefix || path.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

function prefixFirst(urls: string[], prefix: string): string[] {
  if (prefix === "/") return urls;
  const inside: string[] = [];
  const outside: string[] = [];
  for (const url of urls) {
    if (isUnderPrefix(url, prefix)) inside.push(url);
    else outside.push(url);
  }
  return [...inside, ...outside];
}

function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 9;
  }
}

function firstSegment(url: string): string {
  try {
    return (
      new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? ""
    );
  } catch {
    return "";
  }
}

function isBlogArticle(url: string, rootUrl: string): boolean {
  return categorizeUrl(url, rootUrl) === "Blog" && pathDepth(url) > 1;
}

function isNestedDocs(url: string, rootUrl: string): boolean {
  return categorizeUrl(url, rootUrl) === "Docs" && pathDepth(url) > 2;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isDuplicateHome(url: string, rootUrl: string): boolean {
  try {
    const rootPath = new URL(rootUrl).pathname.replace(/\/+$/, "") || "/";
    const path = pathnameOf(url).replace(/\/+$/, "") || "/";
    return rootPath === "/" && /^\/home$/i.test(path);
  } catch {
    return false;
  }
}

function shouldSkipUrl(url: string, rootUrl: string): boolean {
  return isUtilityPath(pathnameOf(url)) || isDuplicateHome(url, rootUrl);
}

/** Feature/docs/legal trees over collection children like /customers/slug. */
function isCoreSitePath(url: string): boolean {
  const segs = pathnameOf(url).split("/").filter(Boolean);
  if (segs.length <= 1) return true;
  return /^(features?|products?|solutions?|platform|pricing|docs?|documentation|help|support|guides?|legal|security|company|about|careers?|contact)$/i.test(
    segs[0]!,
  );
}

function isPinnedNav(url: string, rootUrl: string): boolean {
  const category = categorizeUrl(url, rootUrl);
  if (category === "Other") return false;
  if (category === "Blog") return pathDepth(url) <= 1;
  return true;
}

function crawlScore(
  url: string,
  rootUrl: string,
  fromNav: boolean,
): number {
  const category = categorizeUrl(url, rootUrl);
  let score = (CATEGORY_SCORE[category] ?? 9) * 100;
  score += Math.min(pathDepth(url), 8) * 8;
  if (fromNav && isPinnedNav(url, rootUrl)) score -= 500;
  if (isCoreSitePath(url)) score -= 80;
  if (isBlogArticle(url, rootUrl)) score += 250;
  if (isNestedDocs(url, rootUrl)) score += 80;
  return score;
}

/**
 * Pick a diverse crawl set: nav + product/legal/docs first, blog last.
 * Caps only apply on whole-site crawls so `/docs` still fills with docs.
 */
function selectCrawlUrls(params: {
  rootUrl: string;
  navUrls: string[];
  sitemapUrls: string[];
  limit: number;
  capHeavySections: boolean;
}): string[] {
  const { rootUrl, navUrls, sitemapUrls, limit, capHeavySections } = params;
  const fromNav = new Set(navUrls);
  const unique: string[] = [];
  const seen = new Set<string>();

  function add(url: string): void {
    if (!url || seen.has(url) || shouldSkipUrl(url, rootUrl)) return;
    seen.add(url);
    unique.push(url);
  }

  add(rootUrl);
  for (const url of navUrls) add(url);
  for (const url of sitemapUrls) add(url);

  unique.sort((a, b) => {
    const diff =
      crawlScore(a, rootUrl, fromNav.has(a)) -
      crawlScore(b, rootUrl, fromNav.has(b));
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  const maxBlog = capHeavySections
    ? Math.max(4, Math.floor(limit * BLOG_BUDGET_RATIO))
    : limit;
  const maxDocs = capHeavySections
    ? Math.max(6, Math.floor(limit * DOCS_BUDGET_RATIO))
    : limit;
  const maxOther = capHeavySections
    ? Math.max(4, Math.floor(limit * OTHER_BUDGET_RATIO))
    : limit;
  const maxPrefix = capHeavySections
    ? Math.max(8, Math.floor(limit * PREFIX_BUDGET_RATIO))
    : limit;

  const selected: string[] = [];
  let blogCount = 0;
  let docsCount = 0;
  let otherCount = 0;
  const prefixCount = new Map<string, number>();

  function noteSelected(url: string): void {
    if (isBlogArticle(url, rootUrl)) blogCount += 1;
    else if (isNestedDocs(url, rootUrl)) docsCount += 1;
    else if (categorizeUrl(url, rootUrl) === "Other") otherCount += 1;
    const seg = firstSegment(url);
    if (seg && pathDepth(url) > 1) {
      prefixCount.set(seg, (prefixCount.get(seg) ?? 0) + 1);
    }
  }

  for (const url of unique) {
    if (selected.length >= limit) break;

    const pinned = url === rootUrl || (fromNav.has(url) && isPinnedNav(url, rootUrl));
    if (!pinned) {
      const category = categorizeUrl(url, rootUrl);
      const seg = firstSegment(url);

      if (isBlogArticle(url, rootUrl) && blogCount >= maxBlog) continue;
      if (isNestedDocs(url, rootUrl) && docsCount >= maxDocs) continue;
      if (category === "Other" && otherCount >= maxOther) continue;
      if (seg && pathDepth(url) > 1 && (prefixCount.get(seg) ?? 0) >= maxPrefix) {
        continue;
      }
    }

    selected.push(url);
    noteSelected(url);
  }

  return selected;
}

function parseSitemapUrls(xml: string, base: URL): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) =>
    m[1]!.trim(),
  );

  const urls: string[] = [];
  for (const loc of locs) {
    if (loc.toLowerCase().endsWith(".xml")) {
      continue;
    }
    const normalized = normalizePageUrl(loc, base);
    if (normalized) urls.push(normalized);
  }
  return urls;
}

function parseSitemapIndexes(xml: string, base: URL): string[] {
  if (!/<sitemapindex/i.test(xml)) {
    return [];
  }
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map((m) => m[1]!.trim())
    .map((loc) => normalizeSitemapUrl(loc, base))
    .filter((loc): loc is string => Boolean(loc));
}

/** Blog sitemaps last so legal/product/docs maps are read within the scan cap. */
function sitemapMapPriority(mapUrl: string): number {
  const path = mapUrl.toLowerCase();
  if (/\/(blog|news|articles?|posts?)(?:\/|[-_.]|\.xml|$)/.test(path)) return 80;
  if (/changelog/.test(path)) return 60;
  if (/\/(docs?|handbook|guides?)(?:\/|[-_.]|\.xml|$)/.test(path)) return 40;
  if (/\/(legal|security|privacy|trust)(?:\/|[-_.]|\.xml|$)/.test(path)) return 5;
  if (/\/(other|pages)(?:\/|[-_.]|\.xml|$)/.test(path)) return 10;
  return 20;
}

async function sitemapSeeds(root: URL): Promise<string[]> {
  const origin = originOf(root);
  const seeds = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const robots = await fetchText(`${origin}/robots.txt`, undefined, root);
  if (robots) {
    for (const line of robots.split(/\r?\n/)) {
      const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
      if (!match) continue;
      const normalized = normalizeSitemapUrl(match[1]!, root);
      if (normalized) seeds.push(normalized);
    }
  }
  return [...new Set(seeds)];
}

async function collectFromSitemaps(
  root: URL,
  limit: number,
): Promise<string[]> {
  const found = new Set<string>();
  const queue = await sitemapSeeds(root);
  const seenMaps = new Set<string>();

  while (queue.length > 0 && found.size < limit) {
    queue.sort((a, b) => sitemapMapPriority(a) - sitemapMapPriority(b));
    const mapUrl = queue.shift()!;
    if (seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);

    const xml = await fetchText(mapUrl, undefined, root);
    if (!xml) continue;

    for (const child of parseSitemapIndexes(xml, root)) {
      if (!seenMaps.has(child) && seenMaps.size + queue.length < MAX_SITEMAPS) {
        queue.push(child);
      }
    }

    for (const page of parseSitemapUrls(xml, root)) {
      found.add(page);
      if (found.size >= limit) break;
    }
  }

  return [...found];
}

async function harvestNavUrls(root: URL, prefix: string): Promise<string[]> {
  const page = await loadPageHtml(root.href, { sameSiteAs: root });
  if (!page) return [];

  const nav: string[] = [];
  const seen = new Set<string>();
  const base = new URL(page.finalUrl);

  for (const href of extractLinks(page.html, base)) {
    const normalized = normalizePageUrl(href, root);
    if (!normalized || seen.has(normalized)) continue;
    if (shouldSkipUrl(normalized, root.href)) continue;
    seen.add(normalized);
    nav.push(normalized);
  }

  return prefixFirst(nav, prefix);
}

/**
 * Discover crawlable same-host URLs via sitemap + BFS link following.
 * Whole-site crawls rank product/legal/nav pages ahead of blog archives.
 */
export async function discoverUrls(
  inputUrl: string,
  limit = MAX_CRAWL_PAGES,
): Promise<{ rootUrl: string; urls: string[] }> {
  const root = await normalizeRootUrl(inputUrl);
  const rootHref = root.href;
  const deadline = Date.now() + MAX_CRAWL_MS;
  const prefix = pathPrefix(root);

  const ordered: string[] = [];
  const seen = new Set<string>();

  function enqueue(url: string): void {
    if (seen.has(url) || ordered.length >= limit) return;
    if (shouldSkipUrl(url, rootHref)) return;
    seen.add(url);
    ordered.push(url);
  }

  const navUrls = await harvestNavUrls(root, prefix);
  const fromSitemap = await collectFromSitemaps(root, SITEMAP_SCAN_LIMIT);
  const selected = selectCrawlUrls({
    rootUrl: rootHref,
    navUrls,
    sitemapUrls: prefixFirst(fromSitemap, prefix),
    limit,
    capHeavySections: prefix === "/",
  });

  for (const url of selected) {
    enqueue(url);
  }

  let cursor = 0;
  while (
    cursor < ordered.length &&
    ordered.length < limit &&
    Date.now() < deadline
  ) {
    const batch = ordered.slice(cursor, cursor + BROWSER_CONCURRENCY);
    cursor += batch.length;

    const pages = await mapPool(batch, BROWSER_CONCURRENCY, async (url) =>
      loadPageHtml(url, { sameSiteAs: root }),
    );

    const linked: string[] = [];
    for (const page of pages) {
      if (!page || Date.now() >= deadline) continue;
      const base = new URL(page.finalUrl);
      for (const href of extractLinks(page.html, base)) {
        const normalized = normalizePageUrl(href, root);
        if (normalized) linked.push(normalized);
      }
    }

    for (const url of prefixFirst(linked, prefix)) {
      enqueue(url);
      if (ordered.length >= limit) break;
    }
  }

  return { rootUrl: rootHref, urls: ordered.slice(0, limit) };
}
