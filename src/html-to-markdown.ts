import * as cheerio from "cheerio";
import { tables as turndownTables } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

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
  "[class*='playground']",
  "[class*='Playground']",
  "[class*='code-editor']",
  "[class*='CodeEditor']",
  "[class*='live-preview']",
  "[class*='LivePreview']",
  "[class*='email-preview']",
  "[class*='preview-pane']",
  "[class*='cm-editor']",
  "[class*='monaco-editor']",
  "[class*='CodeMirror']",
  "[data-id*='react-email']",
  "[data-id='__react-email-container']",
  "[class*='sandbox']",
  "[class*='Sandbox']",
  "[class*='demo']",
  "[class*='Demo']",
];

//Source samples and syntax highlighters > dropped unless the page is docs.
const CODE_SELECTORS = [
  "pre",
  "samp",
  "[class*='shiki']",
  "[class*='prism']",
  "[class*='hljs']",
  "[class*='highlight-']",
  "[class*='syntax']",
  "[class*='code-block']",
  "[class*='CodeBlock']",
  "[class*='codeblock']",
  "[class*='code-sample']",
  "[class*='code-snippet']",
  "[class*='snippet']",
  "[class*='Snippet']",
  "[class*='terminal']",
  "[class*='Terminal']",
  "[class*='console']",
  "[data-language]",
  "[data-lang]",
  "[data-rehype-pretty-code-fragment]",
  "[data-rehype-pretty-code-figure]",
];

const BOILERPLATE_HEADING =
  /^(related|related (articles|posts|products|links)|recommended|you may also like|popular|trending|share( this)?|follow us|subscribe|newsletter|partners|as seen in|trusted by|back to( top| home)?|skip to (content|main)|table of contents|on this page|contents|navigation|menu|categories|tags|recent posts|more from|explore|get started|sign up|log in|login|try (it )?free|book a demo|contact sales|request a demo)$/i;

const CTA_LINE =
  /^(get started|sign up( free)?|sign in|log in|login|contact( us| sales)?|book( a)? demo|request( a)? demo|try( it)?( for)? free|start( for)? free|learn more|read more|see( all| more| pricing| examples)?|view( all| more)?|download|subscribe|join( now| free)?|talk to (us|sales)|schedule a call|watch( the)? (demo|video)|check the docs|documentation|docs|pricing|home|features|blog|careers|about( us)?|privacy( policy)?|terms( of (service|use))?|cookie(s| policy)?|copy( to clipboard)?|copied!?)$/i;

const DECORATIVE_ALT =
  /\b(logo|icon|image|photo|picture|background|banner|hero|illustration|screenshot|graphic|pattern|gradient|texture|glow|ray|blur|decoration|decorative|mockup|thumbnail|avatar|placeholder|arrow|divider|shape)\b/i;

// Alt text that describes chrome, not information an agent can answer with. 
function isDecorativeAlt(alt: string): boolean {
  const text = alt.trim();
  if (!text) return true;
  if (DECORATIVE_ALT.test(text)) return true;
  // Two-word labels carry no fact unless they include a figure.
  return text.split(/\s+/).length <= 3 && !/\d/.test(text);
}

const LANGUAGE_NAME = /^[a-z0-9+#]{1,12}$/i;

// Reads attributes from either a cheerio node or a Turndown DOM node.
function attributeOf(node: unknown, name: string): string {
  if (!node) return "";
  const el = node as {
    attribs?: Record<string, string>;
    getAttribute?: (n: string) => string | null;
  };
  return el.attribs?.[name] ?? el.getAttribute?.(name) ?? "";
}

function codeLanguage(node: unknown): string {
  for (const name of ["data-language", "data-lang", "language", "lang"]) {
    const value = attributeOf(node, name).trim();
    if (LANGUAGE_NAME.test(value)) return value.toLowerCase();
  }

  const className = attributeOf(node, "class");
  const match = className.match(/(?:^|\s)(?:lang|language)-([a-z0-9+#]{1,12})/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function createTurndown(keepCode: boolean): TurndownService {
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

  if (keepCode) {
    // Docs examples are knowledge: emit them as fenced blocks with a language.
    turndown.addRule("fencedSourceBlocks", {
      filter: "pre",
      replacement(_content, node) {
        const el = node as unknown as {
          textContent?: string | null;
          querySelector?: (s: string) => unknown;
        };
        const body = (el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
        if (!body) return "";
        const language = codeLanguage(node) || codeLanguage(el.querySelector?.("code"));
        return `\n\n\`\`\`${language}\n${body}\n\`\`\`\n\n`;
      },
    });
  } else {
    turndown.remove(["pre"]);
    turndown.addRule("dropSourceBlocks", {
      filter(node) {
        if (node.nodeName === "PRE") return true;
        return (
          node.nodeName === "CODE" &&
          (node.parentNode?.nodeName === "PRE" ||
            (node.textContent ?? "").includes("\n"))
        );
      },
      replacement() {
        return "";
      },
    });
  }

  // Inline code reads as prose either way; only block code needs a fence.
  turndown.addRule("inlineCodeAsText", {
    filter(node) {
      return (
        (node.nodeName === "CODE" ||
          node.nodeName === "KBD" ||
          node.nodeName === "SAMP") &&
        node.parentNode?.nodeName !== "PRE"
      );
    },
    replacement(content, node) {
      const text = content.replace(/\r/g, "");
      if (keepCode && text.includes("\n")) {
        return `\n\n\`\`\`${codeLanguage(node)}\n${text.trim()}\n\`\`\`\n\n`;
      }
      return text.replace(/\s+/g, " ").trim();
    },
  });

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
      // Keep descriptive alts as plain text (metrics captions, chart labels).
      return isDecorativeAlt(alt) ? "" : alt;
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

//Remove containers that are short nav links.
function removeLinkFarms($: cheerio.CheerioAPI): void {
  $("ul, ol, div, section, nav").each((_, node) => {
    const $el = $(node);
    if (!$el.parent().length) return;
    // Never strip data tables 
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

//Drop “Related / Share / Subscribe” sections by heading label.
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

const LINE_NUMBER_SELECTORS =
  "[class*='line-number'], [class*='linenumber'], [class*='line-num'], [class*='cm-gutter']";

const CODE_KEYWORD =
  /^(import|export|const|let|var|function|class|interface|type|enum|return|await|async|public|private|def|require|package|if|else|for|while|switch|try|catch|throw|SELECT|INSERT|curl)\b/;

const CODE_PUNCTUATION = /[;{}()=<>[\]]/;

const CODE_OPERATOR = /=>|\(\)|\)\s*\{|\);|\};|\]\)|::|&&|\|\||===|!==|\+=/;

/** True for a single line that reads as source code rather than prose. */
function looksLikeCodeLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (text.length > 400) return false;

  if (CODE_KEYWORD.test(text) && CODE_PUNCTUATION.test(text)) return true;
  // Structural punctuation only: `});`, `}`, `),`.
  if (/^[{}[\]()<>;,.:]+$/.test(text)) return true;
  if (/^<\/?[A-Za-z][\w:.-]*(\s[^<>]*)?\/?>[,;]?$/.test(text)) return true;
  if (/^<\/?[A-Za-z][\w:.-]*\s+[\w:-]+=/.test(text)) return true;
  // JSON payloads: `{ "id": "…" }` or `"key": value,`.
  if (/^\{?\s*"[\w.$-]+"\s*:\s*.+[},]?$/.test(text)) return true;
  if (/^[\w$][\w$.]*\s*[:=]\s*[^\s].*[;,]$/.test(text)) return true;
  if (/^[\w$][\w$.]*\([^)]*\)\s*[;,]?$/.test(text) && /[;(]/.test(text)) {
    return true;
  }
  if (/^[\w-]+=(["'{]|\$)/.test(text)) return true;
  // Template interpolation left in a sample: `Hello {username},`.
  if (/\{\s*[\w$.]+\s*\}/.test(text)) return true;
  if (CODE_OPERATOR.test(text)) return true;
  return false;
}

/** Gutter-numbered source viewers render one line per element: `12const x = 1`. */
function stripLeadingLineNumber(line: string): string {
  return line.replace(/^\s*\d{1,4}\s?/, "");
}

function isNumberedSourceLine(line: string): boolean {
  const text = line.trim();
  if (!/^\d{1,4}(\s|\S)/.test(text)) return false;
  const body = stripLeadingLineNumber(text).trim();
  if (!body) return true;
  return looksLikeCodeLine(body);
}

function codeLineRatio(lines: string[]): number {
  if (lines.length === 0) return 0;
  let hits = 0;
  for (const line of lines) {
    if (looksLikeCodeLine(line) || isNumberedSourceLine(line)) hits += 1;
  }
  return hits / lines.length;
}

function isSourceDump(lines: string[]): boolean {
  const meaningful = lines.filter(Boolean);
  if (meaningful.length < 3) return false;
  return codeLineRatio(meaningful) >= 0.6;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripGutterNumbers(lines: string[]): string[] {
  const numbered = lines.filter(isNumberedSourceLine).length;
  if (numbered / Math.max(lines.length, 1) < 0.6) return lines;
  return lines.map(stripLeadingLineNumber);
}

const LINE_WRAPPER_CLASS = /(^|[\s-])(line|row)([\s-]|$)/i;

function isLineWrapper($: cheerio.CheerioAPI, node: any): boolean {
  const $node = $(node);
  const tag = String($node.prop("tagName") ?? "").toLowerCase();
  if (tag === "div" || tag === "p") return true;
  return LINE_WRAPPER_CLASS.test($node.attr("class") ?? "");
}

/**
 * Highlighters like Prism wrap each line in an element and emit no newline,
 * so the raw text would collapse the whole sample onto one line.
 */
function codeLines($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string[] {
  const text = $el.text();
  if (text.includes("\n")) return text.split("\n");

  let $node = $el;
  for (let depth = 0; depth < 3; depth++) {
    const only = $node.children();
    if (only.length !== 1) break;
    $node = only.first();
  }

  const children = $node.children().toArray();
  if (children.length >= 2 && children.every((child) => isLineWrapper($, child))) {
    return children.map((child) =>
      $(child).text().replace(/\t/g, "  ").trimEnd(),
    );
  }

  return [text];
}

function normalizePreBlocks($: cheerio.CheerioAPI): void {
  $("pre").each((_, node) => {
    const $el = $(node);
    $el.find(LINE_NUMBER_SELECTORS).remove();

    const language = codeLanguage(node) || codeLanguage($el.find("code")[0]);
    const cleaned = stripGutterNumbers(codeLines($, $el))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();

    if (!cleaned.trim()) {
      $el.remove();
      return;
    }

    const attr = language ? ` class="language-${language}"` : "";
    $el.replaceWith(`<pre><code${attr}>${escapeHtml(cleaned)}</code></pre>`);
  });
}

/**
 * Handle code viewers that render one element per line, so they carry no `<pre>`.
 * On docs pages they become real code blocks; elsewhere they are noise.
 */
function collectCodeContainers($: cheerio.CheerioAPI, keepCode: boolean): void {
  $(LINE_NUMBER_SELECTORS).remove();

  $("div, section, ol, ul, p, td").each((_, node) => {
    const $el = $(node);
    if (!$el.parent().length) return;
    if ($el.find("h1, h2, h3, table, pre").length) return;

    // One element per line is the highlighter shape; indentation lives in the text.
    const childLines = $el
      .children()
      .toArray()
      .map((child) => $(child).text().replace(/\t/g, "  ").trimEnd());
    const textLines = $el
      .text()
      .split("\n")
      .map((line) => line.trimEnd());

    const source = isSourceDump(childLines.map((line) => line.trim()))
      ? childLines
      : isSourceDump(textLines.map((line) => line.trim()))
        ? textLines
        : null;
    if (!source) return;

    if (!keepCode) {
      $el.remove();
      return;
    }

    const body = stripGutterNumbers(source)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const language = codeLanguage(node);
    const attr = language ? ` class="language-${language}"` : "";
    $el.replaceWith(`<pre><code${attr}>${escapeHtml(body)}</code></pre>`);
  });
}

function isDataTable($el: cheerio.Cheerio<any>): boolean {
  if ($el.find("th").length >= 2) return true;
  if ($el.find("thead").length && $el.find("td").length >= 4) return true;
  if ($el.find("table").length > 0) return false;
  const text = textOf($el);
  const metrics = (text.match(/(\$\d|[\d,]+\s*%|\d+\s*\/\s*mo)/g) ?? []).length;
  return metrics >= 2 && $el.find("td").length >= 4;
}

/**
 * Only real data tables survive. Everything else is layout scaffolding, and
 * nested layout tables are what the GFM plugin leaks as raw HTML.
 */
function flattenLayoutTables($: cheerio.CheerioAPI): void {
  const tables = $("table").toArray().reverse();
  for (const node of tables) {
    const $el = $(node);
    if (!$el.parent().length) continue;
    if (isDataTable($el)) continue;
    $el.remove();
  }
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

/** Fenced code answers nothing a support agent is asked; drop it wholesale. */
const FENCE_TOKEN = "\u27e6into-code-";
const FENCE_TOKEN_END = "\u27e7";
const FENCE_TOKEN_LINE = new RegExp(
  `^${FENCE_TOKEN}(\\d+)${FENCE_TOKEN_END}$`,
);

function isFenceToken(text: string): boolean {
  return FENCE_TOKEN_LINE.test(text.trim());
}

/** Lifts fenced blocks out of the text, leaving one placeholder line each. */
function extractFences(markdown: string, store: string[]): string {
  const out: string[] = [];
  let buffer: string[] | null = null;

  const close = (): void => {
    if (!buffer) return;
    store.push(buffer.join("\n"));
    out.push("", `${FENCE_TOKEN}${store.length - 1}${FENCE_TOKEN_END}`, "");
    buffer = null;
  };

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (buffer) {
        buffer.push(line.trim());
        close();
      } else {
        buffer = [line.trim()];
      }
      continue;
    }
    if (buffer) buffer.push(line);
    else out.push(line);
  }

  close();
  return out.join("\n");
}

function restoreFences(markdown: string, store: string[]): string {
  if (store.length === 0) return markdown;
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.trim().match(FENCE_TOKEN_LINE);
      return match ? (store[Number(match[1])] ?? "") : line;
    })
    .join("\n");
}

function dropFencedCode(markdown: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }

  return out.join("\n");
}

export function cleanMarkdown(markdown: string, keepCode = false): string {
  let text = markdown
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  // Code samples leave the cleaning pipeline as opaque tokens so no
  // line or block heuristic can reindent, split, or drop part of them.
  const fences: string[] = [];
  text = keepCode ? extractFences(text, fences) : dropFencedCode(text);
  text = text.replace(/\]\(([^)]+)\)\[/g, "]($1)\n[");

  const lines = text.split("\n");
  const out: string[] = [];
  let afterSource = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    // Preserve GFM tables untouched.
    if (isTableLine(trimmed)) {
      afterSource = false;
      out.push(line);
      continue;
    }

    // Unfenced code is leaked widget markup, not an example worth keeping.
    if (!keepCode) {
      if (isSourceLine(trimmed)) {
        afterSource = true;
        continue;
      }
      // Orphan gutter numbers left behind by a line-numbered code viewer.
      if (afterSource && /^\d{1,4}$/.test(trimmed)) continue;
      afterSource = false;
    }

    // Headings carry section context ("Pricing", "Docs"), so only the
    // boilerplate list may drop them — never the CTA/chrome heuristics.
    if (/^#{1,6}/.test(trimmed)) {
      const label = trimmed.replace(/^#{1,6}\s*/, "").trim();
      if (!label) continue;
      if (BOILERPLATE_HEADING.test(label)) continue;
      out.push(line);
      continue;
    }

    if (/^!\[.*\]\([^)]+\)$/.test(trimmed)) continue;
    if (isLeakedHtmlLine(trimmed)) continue;
    if (isLinkOnlyLine(trimmed)) continue;
    if (isChromeLine(trimmed)) continue;

    const withoutCopy = trimmed.replace(/^copy to clipboard/i, "").trim();
    if (withoutCopy && withoutCopy !== trimmed) {
      out.push(withoutCopy);
      continue;
    }

    if (/^[-*+]\s+\[[^\]]{1,40}\]\([^)]+\)$/.test(trimmed)) {
      const label = trimmed.match(/^[-*+]\s+\[([^\]]+)\]/)?.[1] ?? "";
      if (label.split(/\s+/).length <= 3 || CTA_LINE.test(label)) continue;
    }

    // Unwrapped inline elements leave gaps before punctuation.
    out.push(line.replace(/\s+([.,;:!?])/g, "$1"));
  }

  text = dropJunkBlocks(out.join("\n"), keepCode);
  text = dropUiFragmentRuns(text);
  text = dedupeRepeatedBlocks(text);
  text = stripOrphanListCtas(text);

  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

  return restoreFences(text, fences);
}

/** A markdown line that is source code or an API payload sample. */
function isSourceLine(line: string): boolean {
  const bare = line
    .replace(/^[-*+]\s+/, "")
    .replace(/^`+|`+$/g, "")
    .trim();
  if (!bare) return false;
  if (/^#{1,6}\s/.test(bare)) return false;
  if (isTableLine(bare)) return false;
  return looksLikeCodeLine(bare) || isNumberedSourceLine(bare);
}

function unglueCamel(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const HTML_TAG = /<\/?[a-z][\w:-]*(\s[^<>]*)?>/gi;
const HTML_TAG_WITH_ATTRIBUTE = /<[a-z][\w:-]*\s+[\w:-]+\s*=/i;

/** Raw markup that survived conversion (nested layout tables, wrappers, srcsets). */
function isLeakedHtmlLine(line: string): boolean {
  if (/joplin-table-wrapper/i.test(line)) return true;
  if (/data-id=["'][^"']*react-email/i.test(line)) return true;
  if (/data-nimg=|_next\/image\?|srcset=/i.test(line)) return true;
  if (HTML_TAG_WITH_ATTRIBUTE.test(line)) return true;

  const tagCount = (line.match(HTML_TAG) ?? []).length;
  return tagCount >= 3;
}

function isChromeLine(line: string): boolean {
  const plain = unglueCamel(
    line
      .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/[*_`#>|[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

  if (!plain) return true;
  if (CTA_LINE.test(plain)) return true;
  // API demo captions: "HTTP 200:", "POST /emails".
  if (/^http\/?[\d.]*\s+\d{3}\s*:?$/i.test(plain)) return true;
  if (/^(get|post|put|patch|delete)\s+\/\S*$/i.test(plain)) return true;
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

function isSourceBlock(block: string): boolean {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 1) return isSourceLine(lines[0]!);
  return isSourceDump(lines);
}

function dropJunkBlocks(markdown: string, keepCode: boolean): string {
  return markdown
    .split(/\n{2,}/)
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed) return false;
      if (isFenceToken(trimmed)) return true;
      if (isLeakedHtmlLine(trimmed)) return false;
      if (!keepCode && isSourceBlock(trimmed)) return false;
      return true;
    })
    .join("\n\n");
}

const UI_FRAGMENT_RUN = 3;

/**
 * Interactive widgets (editors, mail previews, event simulators) collapse into
 * runs of caption-length fragments. Isolated short labels are kept.
 */
function isUiFragmentBlock(block: string): boolean {
  const text = block.trim();
  if (!text || text.includes("\n")) return false;
  if (isFenceToken(text)) return false;
  if (text.length > 48) return false;
  if (/^[#>|]/.test(text)) return false;
  if (/^[-*+]\s/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  if (/[$%]|\d\s*(\/|per)\s*\w/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 6;
}

function dropUiFragmentRuns(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const kept: string[] = [];
  let run: string[] = [];

  const flushRun = (): void => {
    if (run.length > 0 && run.length < UI_FRAGMENT_RUN) kept.push(...run);
    run = [];
  };

  for (const block of blocks) {
    if (isUiFragmentBlock(block)) {
      run.push(block.trim());
      continue;
    }
    flushRun();
    if (block.trim()) kept.push(block.trim());
  }
  flushRun();

  return kept.join("\n\n");
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

// PRE-TURNDOWN CARD STRUCTURING
// Detect div-based card/grid layouts (pricing, features) and restructure

const VALUE_PATTERN =
  /^(\$[\d,.]+|[\d,.]+\s*\/\s*mo|[\d,.]+\s*\/\s*yr|[\d,.]+k?\s*\/\s*mo|unlimited|\u2014|—|-|free|\d{1,5})/i;

const LABEL_PATTERN =
  /^(messages?|agents?|members?|seats?|inboxes?|storage|bandwidth|users?|projects?|price|cost|plan|api (calls|requests)|support|features?|integrations?)$/i;

function isValueLike(text: string): boolean {
  return VALUE_PATTERN.test(text.trim());
}

function isLabelLike(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 40 && !isValueLike(t) && LABEL_PATTERN.test(t);
}

function isShortOrphan(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 60;
}

function pairLabelValues($: cheerio.CheerioAPI): void {
  const containers = $(
    "[class*='pricing'], [class*='plan'], [class*='card'], " +
    "[class*='tier'], [class*='feature'], [data-plan], [data-tier], " +
    "section, article, [role='region']"
  );

  containers.each((_, container) => {
    const $container = $(container);
    const children = $container.children();
    if (children.length < 4) return;

    const toRemove: cheerio.Cheerio<any>[] = [];

    for (let i = 0; i < children.length - 1; i++) {
      const $curr = $(children[i]!);
      const $next = $(children[i + 1]!);

      if (toRemove.some((r) => r.is($curr))) continue;

      const currTag = ($curr.prop("tagName") ?? "").toLowerCase();
      const nextTag = ($next.prop("tagName") ?? "").toLowerCase();

      if (["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table"].includes(currTag)) continue;
      if (["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table"].includes(nextTag)) continue;

      const currText = textOf($curr);
      const nextText = textOf($next);

      if (!isShortOrphan(currText) || !isShortOrphan(nextText)) continue;
      if ($curr.find("h1, h2, h3, h4, h5, h6, ul, ol, table").length) continue;
      if ($next.find("h1, h2, h3, h4, h5, h6, ul, ol, table").length) continue;

      if (isLabelLike(currText) && isValueLike(nextText)) {
        $curr.replaceWith(
          `<p><strong>${currText}</strong>: ${nextText}</p>`
        );
        toRemove.push($next);
        i++;
      } else if (isValueLike(currText) && isLabelLike(nextText)) {
        $curr.replaceWith(
          `<p><strong>${nextText}</strong>: ${currText}</p>`
        );
        toRemove.push($next);
        i++;
      }
    }

    for (const $el of toRemove) {
      $el.remove();
    }
  });
}

function structureCardLayouts($: cheerio.CheerioAPI): void {
  pairLabelValues($);
}

// True when markdown is only chrome / empty after cleaning. 
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

/**
 * Tooltip triggers are buttons inside sentences. Removing them outright leaves
 * holes ("added to a  such as …"), so keep their label before the chrome pass.
 */
function unwrapInlineButtons($: cheerio.CheerioAPI): void {
  $("button").each((_, node) => {
    const $el = $(node);
    if (!$el.parent().length) return;
    if (!$el.parent().is("p, li, td, th, h1, h2, h3, h4, h5, h6, span, em, strong")) {
      return;
    }

    const label = textOf($el);
    if (!label || label.length > 60) return;
    if (CTA_LINE.test(label)) return;

    $el.replaceWith(` ${label} `);
  });
}

/**
 * Headings often wrap anchor links in a block element and break lines with
 * `<br>`; either one makes Turndown emit an empty `##` and orphan the title.
 */
function flattenHeadings($: cheerio.CheerioAPI): void {
  $("h1, h2, h3, h4, h5, h6").each((_, node) => {
    const $el = $(node);
    const text = $el
      .text()
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      $el.remove();
      return;
    }
    $el.text(text);
  });
}

function stripChrome($: cheerio.CheerioAPI, keepCode: boolean): void {
  unwrapInlineButtons($);
  flattenHeadings($);

  const selectors = keepCode
    ? REMOVE_SELECTORS
    : [...REMOVE_SELECTORS, ...CODE_SELECTORS];

  for (const selector of selectors) {
    try {
      $(selector).remove();
    } catch {
      // ignore invalid selector edge cases
    }
  }

  stripBannerHeaders($);
  removeBoilerplateSections($);
  removeLinkFarms($);
  if (keepCode) normalizePreBlocks($);
  collectCodeContainers($, keepCode);
  flattenLayoutTables($);

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

export type ConvertPageOptions = {
  /** Keep code samples as fenced blocks. Set for documentation pages. */
  keepCode?: boolean;
};

export function htmlToMarkdown(
  html: string,
  options: ConvertPageOptions = {},
): string {
  const keepCode = options.keepCode ?? false;
  const $ = cheerio.load(html);

  stripChrome($, keepCode);

  const mainHtml = pickMainHtml($);
  if (!mainHtml.trim()) {
    return "";
  }

  const $$ = cheerio.load(`<div id="into-root">${mainHtml}</div>`);
  stripChrome($$, keepCode);
  structureCardLayouts($$);

  const fragment = $$("#into-root").html() ?? "";
  if (!fragment.trim()) return "";

  const turndown = createTurndown(keepCode);
  return cleanMarkdown(turndown.turndown(fragment), keepCode);
}
