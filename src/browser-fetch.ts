import type { Browser, Page } from "playwright";

import { assertPublicHttpUrl, isPublicHttpUrl } from "./public-url.js";
import type { FetchedHtml } from "./types.js";

const USER_AGENT =
  "IntoMarkdown/1.0 (+https://humaner.io; whole-site markdown for agents)";

const BROWSER_GOTO_TIMEOUT_MS = 30_000;

let browserPromise: Promise<Browser> | null = null;
let launchFailed = false;

async function getBrowser(): Promise<Browser | null> {
  if (launchFailed) return null;

  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import("playwright");
        return chromium.launch({
          headless: true,
          args: ["--disable-dev-shm-usage", "--no-sandbox"],
        });
      } catch (error) {
        launchFailed = true;
        browserPromise = null;
        console.error(
          "[into-markdown] Playwright Chromium unavailable. Run: npm run setup:browser",
          error,
        );
        throw error;
      }
    })();
  }

  try {
    return await browserPromise;
  } catch {
    return null;
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // ignore close errors
  } finally {
    browserPromise = null;
  }
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  const page = await browser.newPage({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
  });

  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Render a URL in headless Chromium and return the post-JS DOM HTML.
 * Network requests to non-public targets are aborted (SSRF guard).
 */
export async function fetchHtmlWithBrowser(
  url: string,
  timeoutMs = BROWSER_GOTO_TIMEOUT_MS,
  options?: { sameSiteAs?: URL },
): Promise<FetchedHtml | null> {
  try {
    await assertPublicHttpUrl(url, { sameSiteAs: options?.sameSiteAs });
  } catch {
    return null;
  }

  return withPage(async (page) => {
    page.setDefaultTimeout(timeoutMs);

    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      try {
        const parsed = new URL(reqUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return route.abort();
        }
        // Allow same-document assets only when public; block private SSRF.
        if (!(await isPublicHttpUrl(parsed))) {
          return route.abort();
        }
        return route.continue();
      } catch {
        return route.abort();
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await page
      .waitForLoadState("networkidle", { timeout: Math.min(8_000, timeoutMs) })
      .catch(() => undefined);

    await page
      .waitForSelector("main, article, h1, [role='main']", {
        timeout: 4_000,
      })
      .catch(() => undefined);

    const finalUrl = page.url();
    try {
      await assertPublicHttpUrl(finalUrl, { sameSiteAs: options?.sameSiteAs });
    } catch {
      return null;
    }

    const html = await page.content();
    if (!html.trim()) {
      return null;
    }

    const contentType = response?.headers()["content-type"] ?? "text/html";

    return {
      url,
      finalUrl,
      html,
      contentType,
      rendered: "browser" as const,
    };
  });
}
