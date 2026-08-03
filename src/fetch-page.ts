import { fetchHtmlWithBrowser } from "./browser-fetch.js";
import { isThinHtml, visibleTextLength } from "./content-quality.js";
import { assertPublicHttpUrl } from "./public-url.js";
import {
  BROWSER_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  type FetchedHtml,
} from "./types.js";

export type { FetchedHtml };

const USER_AGENT =
  "IntoMarkdown/1.0 (+https://humaner.io; whole-site markdown for agents)";

/** Cap HTML / sitemap bodies so a single response cannot blow memory. */
export const MAX_RESPONSE_BYTES = 2_500_000;
const MAX_REDIRECTS = 5;

/** Per-conversion cache so discover BFS and convert share the same HTML. */
const pageCache = new Map<string, FetchedHtml>();

export function clearPageCache(): void {
  pageCache.clear();
}

function cachePage(page: FetchedHtml): FetchedHtml {
  pageCache.set(page.url, page);
  pageCache.set(page.finalUrl, page);
  return page;
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return null;
    }
  }

  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch with manual redirects so each hop is re-checked as a public URL.
 * When `sameSiteAs` is set, redirects must stay on that site.
 */
async function fetchFollowingPublicRedirects(
  url: string,
  init: {
    timeoutMs: number;
    accept: string;
    sameSiteAs?: URL;
  },
): Promise<{ response: Response; finalUrl: string } | null> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(current, {
      sameSiteAs: init.sameSiteAs,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);

    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: init.accept,
          "User-Agent": USER_AGENT,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).href;
        continue;
      }

      return { response, finalUrl: current };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/** HTTP status after public-safe redirects, or null if unreachable. */
export async function probeHttpStatus(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  sameSiteAs?: URL,
): Promise<number | null> {
  try {
    const root = sameSiteAs ?? new URL(url);
    const result = await fetchFollowingPublicRedirects(url, {
      timeoutMs,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      sameSiteAs: root,
    });
    return result?.response.status ?? null;
  } catch {
    return null;
  }
}

export async function fetchHtml(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  sameSiteAs?: URL,
): Promise<FetchedHtml | null> {
  try {
    const root = sameSiteAs ?? new URL(url);
    const result = await fetchFollowingPublicRedirects(url, {
      timeoutMs,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      sameSiteAs: root,
    });
    if (!result) return null;

    const { response, finalUrl } = result;
    if (!response.ok) return null;

    // Final URL must still be public + same-site.
    await assertPublicHttpUrl(finalUrl, { sameSiteAs: root });

    const contentType = response.headers.get("content-type");
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    const html = await readBodyCapped(response, MAX_RESPONSE_BYTES);
    if (!html?.trim()) return null;

    return {
      url,
      finalUrl,
      html,
      contentType,
      rendered: "static",
    };
  } catch {
    return null;
  }
}

/**
 * Fast HTTP fetch first; upgrade to Playwright when the HTML looks like a JS shell.
 */
export async function loadPageHtml(
  url: string,
  options?: {
    staticTimeoutMs?: number;
    browserTimeoutMs?: number;
    /** Force Chromium even when static HTML looks rich. */
    forceBrowser?: boolean;
    sameSiteAs?: URL;
  },
): Promise<FetchedHtml | null> {
  const cached = pageCache.get(url);
  if (cached && !options?.forceBrowser) {
    return cached;
  }

  const staticTimeoutMs = options?.staticTimeoutMs ?? FETCH_TIMEOUT_MS;
  const browserTimeoutMs = options?.browserTimeoutMs ?? BROWSER_TIMEOUT_MS;
  const sameSiteAs = options?.sameSiteAs ?? new URL(url);

  if (!options?.forceBrowser) {
    const staticPage = await fetchHtml(url, staticTimeoutMs, sameSiteAs);
    if (staticPage && !isThinHtml(staticPage.html)) {
      return cachePage(staticPage);
    }

    const browserPage = await fetchHtmlWithBrowser(url, browserTimeoutMs, {
      sameSiteAs,
    });
    if (browserPage) {
      if (
        !staticPage ||
        visibleTextLength(browserPage.html) >
          visibleTextLength(staticPage.html) * 1.15
      ) {
        return cachePage(browserPage);
      }
      return cachePage(staticPage);
    }

    return staticPage ? cachePage(staticPage) : null;
  }

  const forced = await fetchHtmlWithBrowser(url, browserTimeoutMs, {
    sameSiteAs,
  });
  return forced ? cachePage(forced) : null;
}

export async function fetchText(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  sameSiteAs?: URL,
): Promise<string | null> {
  try {
    const root = sameSiteAs ?? new URL(url);
    const result = await fetchFollowingPublicRedirects(url, {
      timeoutMs,
      accept: "application/xml,text/xml,text/plain,*/*;q=0.8",
      sameSiteAs: root,
    });
    if (!result || !result.response.ok) return null;
    await assertPublicHttpUrl(result.finalUrl, { sameSiteAs: root });
    return readBodyCapped(result.response, MAX_RESPONSE_BYTES);
  } catch {
    return null;
  }
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
