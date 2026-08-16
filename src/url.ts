import { assertPublicHttpUrl } from "./public-url.js";

const SKIP_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".xml",
  ".json",
  ".zip",
  ".gz",
  ".mp4",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

export async function normalizeRootUrl(input: string): Promise<URL> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL is required.");
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Invalid URL.");
  }

  // Strip credentials before any network work.
  url.username = "";
  url.password = "";

  await assertPublicHttpUrl(url);

  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url;
}

/** Canonical host for same-site checks (www ↔ apex treated as equal). */
export function canonicalHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function sameSite(a: URL, b: URL): boolean {
  return canonicalHost(a.hostname) === canonicalHost(b.hostname);
}

export function normalizePageUrl(href: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.username || url.password) {
    return null;
  }

  if (!sameSite(url, base)) {
    return null;
  }

  url.hash = "";

  const pathname = url.pathname.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (pathname.endsWith(ext)) {
      return null;
    }
  }

  // Drop tracking / session query noise; keep empty search for stability.
  if (url.search) {
    const params = new URLSearchParams(url.search);
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "ref",
      "mc_cid",
      "mc_eid",
    ];
    for (const key of drop) {
      params.delete(key);
    }
    url.search = params.toString() ? `?${params.toString()}` : "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.href;
}

/** Auth walls are not knowledge. Contact pages can be — keep those. */
export function isNonKnowledgePath(pathname: string): boolean {
  return /\/(login|log-in|signin|sign-in|signup|sign-up|register|auth)(?:\/|$)/i.test(
    pathname,
  );
}

/** CTA / account-flow URLs that should not occupy crawl slots. */
export function isUtilityPath(pathname: string): boolean {
  return (
    isNonKnowledgePath(pathname) ||
    /\/(get-started|getting-started|confirm|unsubscribe|verify-email|callback|oauth)(?:\/|$)/i.test(
      pathname,
    )
  );
}

/** Same-site sitemap index URLs (.xml only). */
export function normalizeSitemapUrl(href: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password) return null;
  if (!sameSite(url, base)) return null;

  const path = url.pathname.toLowerCase();
  if (!path.endsWith(".xml")) return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  return url.href;
}

export function hostnameFilename(rootUrl: string): string {
  try {
    const host = canonicalHost(new URL(rootUrl).hostname);
    return `${host || "site"}.md`;
  } catch {
    return "site.md";
  }
}
