import * as cheerio from "cheerio";

const THIN_TEXT_CHARS = 280;
const RICH_TEXT_CHARS = 600;

/**
 * Detect SPA / JS shells where the HTTP HTML has little readable content.
 */
export function isThinHtml(html: string): boolean {
  if (!html.trim()) return true;

  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();

  const text = ($("body").text() || $.root().text())
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < THIN_TEXT_CHARS) {
    return true;
  }

  const scriptCount = (html.match(/<script[\s>]/gi) ?? []).length;
  const hasRootShell =
    /id=["'](?:root|__next|app|__nuxt)["']/i.test(html) &&
    text.length < RICH_TEXT_CHARS;

  // Lots of scripts + little prose → likely client-rendered.
  if (scriptCount >= 5 && text.length < RICH_TEXT_CHARS) {
    return true;
  }

  return hasRootShell;
}

export function visibleTextLength(html: string): number {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template").remove();
  return ($("body").text() || $.root().text()).replace(/\s+/g, " ").trim()
    .length;
}
