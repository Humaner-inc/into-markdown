import { extractLinks } from "./html-to-markdown.js";
import { fetchText, loadPageHtml, mapPool } from "./fetch-page.js";
import { BROWSER_CONCURRENCY, MAX_CRAWL_MS, MAX_CRAWL_PAGES } from "./types.js";
import { normalizePageUrl, normalizeRootUrl, normalizeSitemapUrl } from "./url.js";

function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
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

async function collectFromSitemaps(
  root: URL,
  limit: number,
): Promise<string[]> {
  const origin = originOf(root);
  const found = new Set<string>();
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seenMaps = new Set<string>();

  while (queue.length > 0 && found.size < limit) {
    const mapUrl = queue.shift()!;
    if (seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);

    const xml = await fetchText(mapUrl, undefined, root);
    if (!xml) continue;

    for (const child of parseSitemapIndexes(xml, root)) {
      if (!seenMaps.has(child) && seenMaps.size < 20) {
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

/**
 * Discover crawlable same-host URLs via sitemap + BFS link following.
 * BFS uses hybrid load (static → Playwright) so JS navs still yield links.
 */
export async function discoverUrls(
  inputUrl: string,
  limit = MAX_CRAWL_PAGES,
): Promise<{ rootUrl: string; urls: string[] }> {
  const root = await normalizeRootUrl(inputUrl);
  const rootHref = root.href;
  const deadline = Date.now() + MAX_CRAWL_MS;

  const ordered: string[] = [];
  const seen = new Set<string>();

  function enqueue(url: string): void {
    if (seen.has(url) || ordered.length >= limit) return;
    seen.add(url);
    ordered.push(url);
  }

  enqueue(rootHref);

  const fromSitemap = await collectFromSitemaps(root, limit);
  for (const url of fromSitemap) {
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

    for (const page of pages) {
      if (!page || Date.now() >= deadline) continue;
      const base = new URL(page.finalUrl);
      for (const href of extractLinks(page.html, base)) {
        const normalized = normalizePageUrl(href, root);
        if (normalized) enqueue(normalized);
        if (ordered.length >= limit) break;
      }
    }
  }

  return { rootUrl: rootHref, urls: ordered.slice(0, limit) };
}
