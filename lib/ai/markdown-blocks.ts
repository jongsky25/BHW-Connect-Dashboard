/**
 * A deliberately small Markdown subset for rendering an audited assistant answer
 * (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.2).
 *
 * The answers are already written as prose with lists and figures — rule 13 asks for exactly that —
 * and until now they rendered through `whitespace-pre-wrap`, so a comparison the model wrote as a
 * table arrived as a wall of pipes. This restores the structure without pulling a Markdown stack in
 * for one admin surface, which the README's free-tier and bundle posture argues against.
 *
 * Two rules make the subset safe rather than merely small:
 *
 * 1. **No links, ever.** Not unsupported — deliberately absent. The text is model-authored, and
 *    the only trustworthy links on this page are the citation links the *server* emits from the
 *    retrieval payload (Increment 2.3). A clickable URL the model wrote would be indistinguishable
 *    from one, which is the whole property 2.3 was built to guarantee. `[text](url)` therefore
 *    renders as those literal characters.
 * 2. **No raw HTML.** This module emits a data structure, never markup; the renderer turns it into
 *    React elements, so any angle brackets in the answer are text by construction. Nothing here
 *    produces a string that could be handed to `dangerouslySetInnerHTML`.
 *
 * Anything outside the subset degrades to literal text rather than being dropped — an answer that
 * survived two audits must never lose a sentence to a formatting parser.
 */

export type Inline =
  { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "code"; text: string };

export type Block =
  | { kind: "heading"; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

/**
 * Split one line into text, `**bold**` and `` `code` `` runs.
 *
 * Hand-written rather than regex-driven for one reason worth stating: an unclosed marker must
 * degrade to literal text, and a regex that matches only balanced pairs silently drops the
 * unbalanced remainder. Here the scanner falls through to text when it cannot find a closing
 * marker, so `**` in the middle of a sentence prints as `**`.
 *
 * Code wins over bold, as in real Markdown: `` `**not bold**` `` is a code span containing
 * asterisks.
 */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let text = "";

  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };

  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: line.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (line.startsWith("**", i)) {
      const end = line.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "bold", text: line.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    text += line[i];
    i += 1;
  }

  flush();
  return out;
}

/** `| a | b |` → ["a", "b"], tolerating the optional leading and trailing pipes. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/** A table's second line: `|---|---|`, optionally with alignment colons. */
function isSeparatorRow(line: string | undefined): boolean {
  if (!line || !line.includes("-")) return false;
  return splitRow(line).every((cell) => /^:?-{1,}:?$/.test(cell));
}

const isTableRow = (line: string) => line.trim().startsWith("|");
const UNORDERED = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/**
 * Parse an answer into blocks. Blank lines separate paragraphs; everything else is decided by the
 * shape of the line itself, so no state survives a block boundary.
 */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    // A table needs its separator row to be a table at all. Without that check a single line of
    // prose containing a pipe would open a one-column table.
    if (isTableRow(line) && isSeparatorRow(lines[i + 1])) {
      flushParagraph();
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", content: parseInline(heading[1]) });
      i += 1;
      continue;
    }

    const listMatch = UNORDERED.exec(line) ?? ORDERED.exec(line);
    if (listMatch) {
      flushParagraph();
      const ordered = UNORDERED.exec(line) === null;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const match = ordered ? ORDERED.exec(lines[i]) : UNORDERED.exec(lines[i]);
        if (!match) break;
        items.push(parseInline(match[1]));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushParagraph();
  return blocks;
}
