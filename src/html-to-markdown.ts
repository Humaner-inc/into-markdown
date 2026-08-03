import * as cheerio from "cheerio";
import { tables as turndownTables } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

/**
 * Strip site chrome before conversion. Goal: Resend-style agent KB pages —
 * prose, headings, tables/metrics — not nav, footer, sidebar, or CTA farms.
 * @see https://resend.com/pricing.md
 */
const REMOVE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "canvas",
  "template",
  "nav",
  "footer",
  "aside",
  "button",
  "form",
  "input",
  "select",
  "textarea",
  "dialog",
  "[role='navigation']",
  "[role='contentinfo']",
  "[role='menu']",
  "[role='menubar']",
  "[role='complementary']",
  "[role='search']",
  "[aria-hidden='true']",
  "[hidden]",
  ".cookie",
  ".cookies",
  "#cookie",
  "#cookies",
  "[class*='cookie']",
  "[id*='cookie']",
  "[class*='consent']",
  "[id*='consent']",
  "[class*='newsletter']",
  "[class*='subscribe-banner']",
  "[class*='social-share']",
  "[class*='share-buttons']",
  "[class*='share-links']",
  "[class*='breadcrumb']",
  "[class*='sidebar']",
  "[class*='side-nav']",
  "[class*='sidenav']",
  "[class*='navbar']",
  "[class*='nav-item']",
  "[class*='nav-link']",
  "[class*='nav-menu']",
  "[class*='NavBar']",
  "[class*='site-footer']",
  "[class*='page-footer']",
  "[class*='Footer']",
  "[class*='toolbar']",
  "[class*='skip-link']",
  "[class*='sr-only']",
  "[class*='announcement']",
  "[class*='promo-banner']",
  "[class*='popup']",
  "[class*='modal']",
  "[class*='toast']",
  "[class*='pagination']",
  "[class*='pager']",
  "[class*='table-of-contents']",
  "[class*='related-posts']",
  "[class*='related-articles']",
  "[class*='related-links']",
  "[class*='recommended']",
  "[class*='comments']",
  "[class*='comment-']",
  "[class*='author-box']",
  "[class*='follow-us']",
  "[class*='mobile-nav']",
  "[class*='MobileNav']",
  "[class*='mobile-menu']",
  "[id*='navbar']",
  "[id*='footer']",
  "[id*='sidebar']",
  "[id*='nav']",
  "[data-nav]",
  "[data-navbar]",
  "[data-footer]",
  "[data-sidebar]",
];

const BOILERPLATE_HEADING =
  /^(related|related (articles|posts|products|links)|recommended|you may also like|popular|trending|share( this)?|follow us|subscribe|newsletter|partners|as seen in|trusted by|back to( top| home)?|skip to (content|main)|table of contents|on this page|contents|navigation|menu|categories|tags|recent posts|more from|explore|get started|sign up|log in|login|try (it )?free|book a demo|contact sales|request a demo)$/i;

const CTA_LINE =
  /^(get started|sign up( free)?|sign in|log in|login|contact( us| sales)?|book( a)? demo|request( a)? demo|try( it)?( for)? free|start( for)? free|learn more|read more|see( all| more| pricing)?|view( all| more)?|download|subscribe|join( now| free)?|talk to (us|sales)|schedule a call|watch( the)? (demo|video)|documentation|docs|pricing|home|features|blog|careers|about( us)?|privacy( policy)?|terms( of (service|use))?|cookie(s| policy)?)$/i;

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  turndown.use(turndownTables);
  turndown.remove(["script", "style", "noscript", "iframe"]);

  turndown.addRule("dropEmptyLinks", {
    filter(node) {
      return (
        node.nodeName === "A" &&
        !(node.textContent ?? "").trim() &&
        !node.querySelector("img")
      );
    },
    replacement() {
      return "";
    },
  });

  // Prefer plain text for short nav-style links; keep longer / URL-like refs.
  turndown.addRule("knowledgeLinks", {
    filter(node) {
      return node.nodeName === "A";
    },
    replacement(content, node) {
      const label = content.replace(/\s+/g, " ").trim();
      if (!label) return "";

      const href =
        (node as unknown as { getAttribute?: (n: string) => string | null })
          .getAttribute?.("href")
          ?.trim() ?? "";

      const words = label.split(/\s+/).filter(Boolean);
      const looksLikeUrl = /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(
        label,
      );
      const isHashOrJs =
        !href || href.startsWith("#") || href.startsWith("javascript:");
      const isShortNav = words.length <= 3 && !looksLikeUrl;

      if (isHashOrJs || isShortNav || CTA_LINE.test(label)) {
        return label;
      }

      return `[${label}](${href})`;
    },
  });

  turndown.addRule("meaningfulImages", {
    filter: "img",
    replacement(_content, node) {
      const el = node as unknown as {
        getAttribute?: (name: string) => string | null;
      };
      const alt = (el.getAttribute?.("alt") || "").trim();
      if (!alt || /^(logo|icon|image|photo|background|banner)$/i.test(alt)) {
        return "";
      }
      // Keep descriptive alts as plain text (metrics captions, chart labels).
      return alt;
    },
  });

  return turndown;
}

function textOf($el: cheerio.Cheerio<any>): string {
  return $el.text().replace(/\s+/g, " ").trim();
}

function linkDensity($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): number {
  const textLen = Math.max(textOf($el).length, 1);
  let linkLen = 0;
  $el.find("a").each((_, a) => {
    linkLen += $(a).text().replace(/\s+/g, " ").trim().length;
  });
  return linkLen / textLen;
}

/** Site chrome often lives in <header>; keep H1/prose, drop nav bars. */
function stripBannerHeaders($: cheerio.CheerioAPI): void {
  $("header, [role='banner'], [class*='Header'], [id*='header']").each(
    (_, node) => {
      const $el = $(node);
      if (!$el.parent().length) return;

      $el
        .find("nav, [role='navigation'], [class*='nav'], [class*='menu']")
        .remove();

      const density = linkDensity($, $el);
      const text = textOf($el);
      const linkCount = $el.find("a").length;
      const hasPrimaryHeading = $el.find("h1").length > 0;
      const hasBodyElsewhere =
        $("main h1, article h1, [role='main'] h1").length > 0;

      const mostlyChrome =
        density > 0.45 ||
        (linkCount >= 4 && text.length < 200) ||
        (text.length < 80 && linkCount >= 2);

      if (mostlyChrome) {
        if (hasPrimaryHeading && !hasBodyElsewhere) {
          const $h1 = $el.find("h1").first().clone();
          $el.replaceWith($h1);
        } else {
          $el.remove();
        }
        return;
      }

      // Mixed hero: drop leftover link clusters, keep copy/metrics.
      $el.find("ul, ol, div").each((__, child) => {
        const $child = $(child);
        if (linkDensity($, $child) > 0.6 && $child.find("a").length >= 3) {
          $child.remove();
        }
      });
    },
  );
}

/** Remove containers that are mostly short nav links. */
function removeLinkFarms($: cheerio.CheerioAPI): void {
  $("ul, ol, div, section, nav").each((_, node) => {
    const $el = $(node);
    if (!$el.parent().length) return;
    // Never strip data tables — they carry metrics.
    if ($el.is("table") || $el.find("> table, table").length) return;
    if ($el.find("table").length && textOf($el.find("table")).length > 40) {
      return;
    }

    const $links = $el.find("> a, > li > a, > div > a, > span > a, > p > a");
    const linkCount = $links.length;
    if (linkCount < 3) return;

    const density = linkDensity($, $el);
    const text = textOf($el);
    const avgLinkLen =
      $links.toArray().reduce((sum, a) => {
        return sum + $(a).text().replace(/\s+/g, " ").trim().length;
      }, 0) / linkCount;

    const looksLikeNav =
      density > 0.5 ||
      (linkCount >= 4 && avgLinkLen < 28 && text.length < 400) ||
      (linkCount >= 6 && density > 0.35) ||
      (linkCount >= 3 && avgLinkLen < 18 && density > 0.4);

    if (looksLikeNav) {
      $el.remove();
    }
  });
}

/** Drop “Related / Share / Subscribe” sections by heading label. */
function removeBoilerplateSections($: cheerio.CheerioAPI): void {
  $("section, div, aside, article").each((_, node) => {
    const $el = $(node);
    if (!$el.parent().length) return;

    const heading = $el
      .find("> h1, > h2, > h3, > h4, > header h1, > header h2, > header h3")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (heading && BOILERPLATE_HEADING.test(heading)) {
      $el.remove();
      return;
    }

    // Card grids that are only short CTA links (no tables/metrics).
    if (
      !$el.find("table, p, li").length &&
      $el.find("a").length >= 3 &&
      linkDensity($, $el) > 0.7 &&
      textOf($el).length < 280
    ) {
      $el.remove();
    }
  });
}

function scoreMainCandidate(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
): number {
  const text = textOf($el);
  if (text.length < 80) return -1;

  const paragraphs = $el.find("p").length;
  const headings = $el.find("h1, h2, h3, h4").length;
  const tables = $el.find("table").length;
  const lists = $el.find("ul, ol").length;
  const density = linkDensity($, $el);

  // Prefer regions rich in prose / metrics over link chrome.
  let score = text.length;
  score += paragraphs * 120;
  score += headings * 80;
  score += tables * 320;
  score += lists * 40;
  score -= density * 900;
  if (density > 0.5) score -= 2000;
  if (density > 0.7) score -= 2000;

  // Bonus for metric-looking content (prices, %, volumes).
  const metrics = (
    text.match(/(\$\d|[\d,]+\s*%|\d+\s*\/\s*mo|\b\d{1,3}(,\d{3})+\b)/g) ?? []
  ).length;
  score += metrics * 40;

  return score;
}

function pickMainHtml($: cheerio.CheerioAPI): string {
  const candidates = [
    "main",
    "article",
    "[role='main']",
    "#main-content",
    "#content",
    ".main-content",
    ".content",
    ".post-content",
    ".entry-content",
    ".prose",
    "[class*='markdown']",
    "[class*='docs-content']",
    "[class*='article']",
    "[class*='pricing']",
    "[class*='Pricing']",
  ];

  let bestHtml = "";
  let bestScore = -1;

  for (const selector of candidates) {
    $(selector).each((_, node) => {
      const $el = $(node);
      const score = scoreMainCandidate($, $el);
      if (score > bestScore) {
        bestScore = score;
        bestHtml = $.html($el) ?? $el.html() ?? "";
      }
    });
  }

  if (bestHtml && bestScore > 0) {
    return bestHtml;
  }

  let fallback = "";
  let fallbackScore = -1;
  $("body > div, body > section, body main, body article").each((_, node) => {
    const $el = $(node);
    const score = scoreMainCandidate($, $el);
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = $.html($el) ?? $el.html() ?? "";
    }
  });

  if (fallback && fallbackScore > 0) {
    return fallback;
  }

  return $("body").html() ?? $.root().html() ?? "";
}

function isTableLine(line: string): boolean {
  return (
    /^\|.+\|$/.test(line.trim()) ||
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
  );
}

/**
 * Post-process markdown into Resend-style agent KB content:
 * prose, headings, tables, real lists. Drop nav dumps and CTA spam.
 */
export function cleanMarkdown(markdown: string): string {
  let text = markdown
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  // Split glued markdown links: ](url)[Label](
  text = text.replace(/\]\(([^)]+)\)\[/g, "]($1)\n[");

  const lines = text.split("\n");
  const out: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    // Preserve GFM tables untouched.
    if (isTableLine(trimmed)) {
      out.push(line);
      continue;
    }

    if (/^!\[.*\]\([^)]+\)$/.test(trimmed)) continue;
    if (isLinkOnlyLine(trimmed)) continue;
    if (isChromeLine(trimmed)) continue;

    if (/^[-*+]\s+\[[^\]]{1,40}\]\([^)]+\)$/.test(trimmed)) {
      const label = trimmed.match(/^[-*+]\s+\[([^\]]+)\]/)?.[1] ?? "";
      if (label.split(/\s+/).length <= 3 || CTA_LINE.test(label)) continue;
    }

    // Drop empty / decorative headings.
    if (/^#{1,6}\s*$/.test(trimmed)) continue;
    if (
      /^#{1,6}\s+/.test(trimmed) &&
      BOILERPLATE_HEADING.test(trimmed.replace(/^#{1,6}\s+/, ""))
    ) {
      continue;
    }

    out.push(line);
  }

  text = dedupeRepeatedBlocks(out.join("\n"));
  text = stripOrphanListCtas(text);

  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function isChromeLine(line: string): boolean {
  const plain = line
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>|[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return true;
  if (CTA_LINE.test(plain)) return true;
  if (/^(©|copyright|\u00a9)/i.test(plain)) return true;
  if (/all rights reserved/i.test(plain)) return true;
  if (
    /^(privacy|terms|cookies?)(\s*[|/·•]\s*(privacy|terms|cookies?))+$/i.test(
      plain,
    )
  ) {
    return true;
  }
  // Bare breadcrumb trails: Home > Pricing > …
  if (
    /^[\w\s]{1,20}(\s*[>›/|]\s*[\w\s]{1,24}){2,}$/i.test(plain) &&
    plain.length < 80
  ) {
    return true;
  }

  // Adjacent unwrapped CTAs: "Get started Book a demo"
  if (isCtaOnlyPhrase(plain)) return true;

  return false;
}

function isCtaOnlyPhrase(plain: string): boolean {
  if (plain.length > 120) return false;
  if (/\d/.test(plain)) return false;

  // Split on spaces into candidate CTA chunks (1–4 words each).
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;

  // Greedy match successive CTA phrases covering the whole line.
  let i = 0;
  let matched = 0;
  while (i < words.length) {
    let hit = false;
    for (let n = Math.min(4, words.length - i); n >= 1; n--) {
      const chunk = words.slice(i, i + n).join(" ");
      if (CTA_LINE.test(chunk)) {
        i += n;
        matched += 1;
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return matched >= 1;
}

function isLinkOnlyLine(line: string): boolean {
  const withoutLinks = line
    .replace(/\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[![\]]/g, "")
    .replace(/\s+/g, "")
    .replace(/[|/·•,;:—–-]/g, "");

  if (withoutLinks.length > 0) return false;

  const linkCount = (line.match(/\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  if (linkCount === 0) return false;
  if (linkCount >= 2) return true;

  const label = line.match(/\[([^\]]*)\]/)?.[1]?.trim() ?? "";
  const words = label.split(/\s+/).filter(Boolean);
  return words.length <= 4 || CTA_LINE.test(label);
}

function bulletLabel(line: string): string {
  const body = line.replace(/^[-*+]\s+/, "").trim();
  const linkLabel = body.match(/^\[([^\]]+)\]\([^)]+\)$/)?.[1];
  return (linkLabel ?? body).replace(/[*_`]/g, "").trim();
}

/** Drop short CTA-only bullet clusters left after chrome strip. */
function stripOrphanListCtas(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const kept: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    const allBullets =
      lines.length > 0 && lines.every((l) => /^[-*+]\s+/.test(l.trim()));
    if (!allBullets) {
      kept.push(block.trim());
      continue;
    }

    const cleanLabels = lines.map(bulletLabel);
    const allShortCtas = cleanLabels.every(
      (label) =>
        CTA_LINE.test(label) ||
        (label.split(/\s+/).length <= 3 &&
          label.length < 28 &&
          !/\d/.test(label)),
    );

    if (allShortCtas && cleanLabels.length <= 8) continue;

    const filtered = lines.filter((_, i) => {
      const label = cleanLabels[i] ?? "";
      if (CTA_LINE.test(label)) return false;
      if (
        label.split(/\s+/).length <= 2 &&
        label.length < 18 &&
        !/\d/.test(label)
      ) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) continue;
    kept.push(filtered.join("\n"));
  }

  return kept.join("\n\n");
}

function dedupeRepeatedBlocks(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const block of blocks) {
    const key = block.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(block.trim());
  }

  return kept.join("\n\n");
}

export function extractTitle(html: string, fallbackUrl: string): string {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:title"]').attr("content")?.trim();
  if (og) return og.replace(/\s*[|\-–—·]\s*.+$/, "").trim() || og;
  const title = $("title").first().text().trim();
  if (title) {
    return title.replace(/\s*[|\-–—·]\s*[^|\-–—·]+$/, "").trim() || title;
  }
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return "Untitled";
  }
}

export function extractBlurb(html: string): string | null {
  const $ = cheerio.load(html);
  const desc = $('meta[name="description"]').attr("content")?.trim();
  if (desc && desc.length > 20) return desc;

  for (const selector of ["main p", "article p", "p"]) {
    const text = $(selector)
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, " ").trim())
      .find((t) => t.length > 40 && t.length < 400 && !/^\[/.test(t));
    if (text) return text;
  }

  return null;
}

export function hasNoindex(html: string): boolean {
  const $ = cheerio.load(html);
  const robots = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
  return robots.includes("noindex");
}

export function extractLinks(html: string, baseUrl: URL): string[] {
  const $ = cheerio.load(html);
  const hrefs: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) hrefs.push(href);
  });
  return hrefs;
}

/** True when markdown is only chrome / empty after cleaning. */
export function isContentlessMarkdown(markdown: string): boolean {
  const prose = markdown
    .replace(/^#+\s+.*$/gm, "")
    .replace(/^\|.*\|$/gm, " metrics ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[*_`>#\-|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return prose.length < 60;
}

function stripChrome($: cheerio.CheerioAPI): void {
  for (const selector of REMOVE_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // ignore invalid selector edge cases
    }
  }

  stripBannerHeaders($);
  removeBoilerplateSections($);
  removeLinkFarms($);

  $("a").each((_, node) => {
    const $el = $(node);
    const label = textOf($el);
    if (!label && !$el.find("img").length) {
      $el.remove();
      return;
    }
    // Drop standalone CTA anchors; keep in-sentence links.
    if (label && CTA_LINE.test(label)) {
      const parentText = textOf($el.parent());
      const alone =
        parentText === label ||
        $el.parent().children().length === 1 ||
        $el.parent().is("li, td, th, h1, h2, h3, h4, h5, h6");
      if (alone) $el.remove();
    }
  });
}

export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  stripChrome($);

  const mainHtml = pickMainHtml($);
  if (!mainHtml.trim()) {
    return "";
  }

  const $$ = cheerio.load(`<div id="into-root">${mainHtml}</div>`);
  stripChrome($$);

  const fragment = $$("#into-root").html() ?? "";
  if (!fragment.trim()) return "";

  const turndown = createTurndown();
  return cleanMarkdown(turndown.turndown(fragment));
}
