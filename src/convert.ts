import { assembleSiteMarkdown } from "./assemble.js";
import { closeBrowser } from "./browser-fetch.js";
import { categorizeUrl, isDocumentationUrl } from "./categorize.js";
import { discoverUrls } from "./discover.js";
import {
  clearPageCache,
  loadPageHtml,
  mapPool,
  probeHttpStatus,
} from "./fetch-page.js";
import {
  extractBlurb,
  extractTitle,
  hasNoindex,
  htmlToMarkdown,
  isChromeTitle,
  isContentlessMarkdown,
} from "./html-to-markdown.js";
import {
  BROWSER_CONCURRENCY,
  BROWSER_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  MAX_CRAWL_MS,
  MAX_CRAWL_PAGES,
  type ConvertResult,
  type CrawledPage,
} from "./types.js";
import { hostnameFilename, isNonKnowledgePath, normalizePageUrl, normalizeRootUrl } from "./url.js";

const MAX_MARKDOWN_CHARS = 1_500_000;

export async function convertSiteToMarkdown(
  inputUrl: string,
): Promise<ConvertResult> {
  const started = Date.now();
  const root = await normalizeRootUrl(inputUrl);

  clearPageCache();

  try {
    const rootStatus = await probeHttpStatus(root.href, FETCH_TIMEOUT_MS, root);
    if (rootStatus === 404) {
      throw new Error(
        "This URL returned a 404 Not Found. Check the link and try again.",
      );
    }

    const { rootUrl, urls } = await discoverUrls(root.href, MAX_CRAWL_PAGES);

    const remainingMs = Math.max(5_000, MAX_CRAWL_MS - (Date.now() - started));
    const perBrowserTimeout = Math.min(
      BROWSER_TIMEOUT_MS,
      Math.max(8_000, Math.floor(remainingMs / Math.max(urls.length, 1))),
    );

    const fetched = await mapPool(urls, BROWSER_CONCURRENCY, async (url) => {
      if (Date.now() - started > MAX_CRAWL_MS) return null;
      return loadPageHtml(url, {
        browserTimeoutMs: perBrowserTimeout,
        sameSiteAs: root,
      });
    });

    const pages: CrawledPage[] = [];
    const seenFinal = new Set<string>();
    const seenBodies = new Set<string>();
    let siteName = root.hostname.replace(/^www\./i, "");
    let blurb: string | null = null;

    const rootPath = root.pathname.replace(/\/+$/, "") || "/";

    for (const page of fetched) {
      if (!page) continue;
      if (hasNoindex(page.html)) continue;

      try {
        if (isNonKnowledgePath(new URL(page.url).pathname)) continue;
        if (isNonKnowledgePath(new URL(page.finalUrl).pathname)) continue;
      } catch {
        continue;
      }

      const requestedNormalized = normalizePageUrl(page.url, root);
      const finalNormalized = normalizePageUrl(page.finalUrl, root);
      if (!finalNormalized) continue;

      const identityUrl = requestedNormalized ?? finalNormalized;
      if (seenFinal.has(identityUrl)) continue;

      const title = extractTitle(page.html, identityUrl);
      const category = categorizeUrl(identityUrl, rootUrl);

      const markdown = htmlToMarkdown(page.html, {
        keepCode:
          category === "Docs" || isDocumentationUrl(identityUrl, rootUrl),
      });
      if (!markdown || isContentlessMarkdown(markdown)) continue;

      const bodyKey = markdown.replace(/\s+/g, " ").trim().toLowerCase();
      if (bodyKey && seenBodies.has(bodyKey)) continue;
      seenBodies.add(bodyKey);
      seenFinal.add(identityUrl);

      const pageBlurb = extractBlurb(page.html);
      let requestedPath = "/";
      try {
        requestedPath = new URL(page.url).pathname.replace(/\/+$/, "") || "/";
      } catch {
        requestedPath = "/";
      }
      const fromRoot = requestedPath === rootPath;

      // Site identity comes from the URL the user pasted, never from a
      // /contact overlay that redirected home and stole og:title.
      if (fromRoot && !isChromeTitle(title)) {
        siteName = title || siteName;
        blurb = pageBlurb ?? blurb;
      } else if (fromRoot && !blurb && pageBlurb && !isChromeTitle(title)) {
        blurb = pageBlurb;
      }

      pages.push({
        url: identityUrl,
        title:
          fromRoot && isChromeTitle(title)
            ? siteName
            : title || identityUrl,
        markdown,
        category,
        blurb: pageBlurb,
      });
    }

    if (pages.length === 0) {
      throw new Error(
        "No crawlable pages found. The site may block bots, or Chromium is not installed.",
      );
    }

    pages.sort((a, b) => {
      if (a.category === "Home" && b.category !== "Home") return -1;
      if (b.category === "Home" && a.category !== "Home") return 1;
      return a.url.localeCompare(b.url);
    });

    const { markdown, categories } = assembleSiteMarkdown({
      rootUrl,
      siteName,
      blurb,
      pages,
    });

    const cappedMarkdown =
      markdown.length > MAX_MARKDOWN_CHARS
        ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n_…truncated for size._\n`
        : markdown;

    return {
      markdown: cappedMarkdown,
      rootUrl,
      siteName,
      pageCount: pages.length,
      categories,
      pages: pages.map((p) => ({
        url: p.url,
        title: p.title,
        category: p.category,
      })),
      filename: hostnameFilename(rootUrl),
    };
  } finally {
    clearPageCache();
    await closeBrowser();
  }
}
