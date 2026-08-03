export const MAX_CRAWL_PAGES = 50;
export const MAX_CRAWL_MS = 5 * 60 * 1000;
/** Parallel static HTTP fetches. */
export const FETCH_CONCURRENCY = 5;
/** Parallel Playwright pages (Chromium is heavier). */
export const BROWSER_CONCURRENCY = 2;
export const FETCH_TIMEOUT_MS = 15_000;
export const BROWSER_TIMEOUT_MS = 30_000;

export type PageCategory =
  | "Home"
  | "Product"
  | "Pricing"
  | "Docs"
  | "Blog"
  | "Company"
  | "Careers"
  | "Legal"
  | "Other";

export const CATEGORY_ORDER: PageCategory[] = [
  "Home",
  "Product",
  "Pricing",
  "Docs",
  "Blog",
  "Company",
  "Careers",
  "Legal",
  "Other",
];

export type FetchedHtml = {
  url: string;
  finalUrl: string;
  html: string;
  contentType: string | null;
  rendered?: "static" | "browser";
};

export type CrawledPage = {
  url: string;
  title: string;
  markdown: string;
  category: PageCategory;
  blurb: string | null;
};

export type ConvertResult = {
  markdown: string;
  rootUrl: string;
  siteName: string;
  pageCount: number;
  categories: Array<{ name: PageCategory; count: number }>;
  pages: Array<{
    url: string;
    title: string;
    category: PageCategory;
  }>;
  filename: string;
};
