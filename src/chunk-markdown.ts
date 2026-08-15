export type MarkdownChunk = {
  content: string;
  heading: string | null;
  chunkIndex: number;
};

/** ~225 tokens — one heading section stays on-topic for agent ingest. */
const MAX_CHUNK_CHARS = 900;
const MIN_CHUNK_CHARS = 40;
const MIN_KEEP_CHARS = 24;

function estimateTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}

export function cleanMarkdownForChunking(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*!\[[^\]]*]\([^)]+\)\s*$/gm, "")
    .replace(/\u200b/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lastSplitIndex(window: string, maxChars: number): number {
  const minCut = Math.floor(maxChars * 0.4);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= minCut) {
    return paragraph;
  }

  let sentence = -1;
  for (let i = 0; i < window.length; i++) {
    const ch = window[i];
    if (
      (ch === "." || ch === "!" || ch === "?") &&
      i + 1 < window.length &&
      /\s/.test(window[i + 1] ?? "")
    ) {
      sentence = i + 1;
    }
  }
  if (sentence >= minCut) {
    return sentence;
  }

  const space = window.lastIndexOf(" ");
  if (space >= minCut) {
    return space;
  }

  return maxChars;
}

export function splitByMaxChars(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const parts: string[] = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      parts.push(remaining);
      break;
    }

    const cut = lastSplitIndex(remaining.slice(0, maxChars), maxChars);
    const piece = remaining.slice(0, cut).trim();
    if (piece) {
      parts.push(piece);
    }
    remaining = remaining.slice(cut).trim();
  }

  if (
    parts.length >= 2 &&
    (parts[parts.length - 1]?.length ?? 0) < MIN_CHUNK_CHARS
  ) {
    const tail = parts.pop() ?? "";
    const prior = parts.pop() ?? "";
    const merged = `${prior}\n\n${tail}`.trim();
    if (merged.length <= Math.ceil(maxChars * 1.2)) {
      parts.push(merged);
    } else {
      parts.push(prior, tail);
    }
  }

  return parts;
}

function prefixHeading(content: string, heading: string | null): string {
  if (!heading) {
    return content;
  }
  const leaf = heading.split(" > ").at(-1)?.trim() ?? heading;
  if (content.includes(leaf)) {
    return content;
  }
  const next = `${heading}\n\n${content}`;
  if (next.length > MAX_CHUNK_CHARS) {
    return content;
  }
  return next;
}

function splitOversizedChunk(
  content: string,
  heading: string | null,
  startIndex: number,
): MarkdownChunk[] {
  const prefixed = prefixHeading(content, heading);
  if (prefixed.length <= MAX_CHUNK_CHARS) {
    return [{ content: prefixed, heading, chunkIndex: startIndex }];
  }

  const paragraphs = prefixed.split(/\n{2,}/).filter(Boolean);
  const chunks: MarkdownChunk[] = [];
  let buffer = "";
  let index = startIndex;

  const flushBuffer = (): void => {
    if (!buffer.trim()) {
      return;
    }
    for (const part of splitByMaxChars(buffer.trim(), MAX_CHUNK_CHARS)) {
      chunks.push({
        content: prefixHeading(part, heading),
        heading,
        chunkIndex: index++,
      });
    }
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    const para = paragraph.trim();
    if (!para) {
      continue;
    }

    if (para.length > MAX_CHUNK_CHARS) {
      flushBuffer();
      for (const part of splitByMaxChars(para, MAX_CHUNK_CHARS)) {
        chunks.push({
          content: prefixHeading(part, heading),
          heading,
          chunkIndex: index++,
        });
      }
      continue;
    }

    const next = buffer ? `${buffer}\n\n${para}` : para;
    if (next.length > MAX_CHUNK_CHARS) {
      flushBuffer();
      buffer = para;
    } else {
      buffer = next;
    }
  }

  flushBuffer();
  return chunks;
}

function buildHeadingPath(stack: (string | null)[]): string | null {
  const parts = stack.filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const path = parts.join(" > ");
  return path.length > 512 ? path.slice(0, 512) : path;
}

export function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const trimmed = cleanMarkdownForChunking(markdown);
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split("\n");
  const sections: { heading: string | null; lines: string[] }[] = [];

  const headingStack: (string | null)[] = [null, null, null, null, null, null];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flushSection = (): void => {
    const content = currentLines.join("\n").trim();
    const keep =
      content.length >= MIN_CHUNK_CHARS ||
      (Boolean(currentHeading) && content.length >= MIN_KEEP_CHARS);
    if (keep) {
      sections.push({ heading: currentHeading, lines: currentLines });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushSection();

      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim().slice(0, 200);

      headingStack[level - 1] = text;
      for (let i = level; i < 6; i++) {
        headingStack[i] = null;
      }

      currentHeading = buildHeadingPath(headingStack);
      currentLines.push(line);
      continue;
    }
    currentLines.push(line);
  }

  flushSection();

  if (sections.length === 0) {
    return splitOversizedChunk(trimmed, null, 0);
  }

  const chunks: MarkdownChunk[] = [];
  let index = 0;
  for (const section of sections) {
    const content = section.lines.join("\n").trim();
    for (const chunk of splitOversizedChunk(content, section.heading, index)) {
      chunks.push(chunk);
      index = chunk.chunkIndex + 1;
    }
  }

  return chunks;
}

export { estimateTokenCount };
