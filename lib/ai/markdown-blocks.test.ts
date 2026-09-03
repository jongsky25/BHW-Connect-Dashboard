import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, type Block } from "./markdown-blocks";

const text = (s: string) => ({ kind: "text", text: s });

describe("parseInline", () => {
  it("reads bold and code runs", () => {
    expect(parseInline("a **b** and `c`")).toEqual([
      text("a "),
      { kind: "bold", text: "b" },
      text(" and "),
      { kind: "code", text: "c" },
    ]);
  });

  // A regex that matches only balanced pairs would drop the remainder; an answer that survived
  // two audits must not lose characters to a formatting parser.
  it("leaves an unclosed marker as literal text", () => {
    expect(parseInline("2 ** 3 = 8")).toEqual([text("2 ** 3 = 8")]);
    expect(parseInline("the ` backtick")).toEqual([text("the ` backtick")]);
  });

  it("treats an empty run as literal, not as an empty element", () => {
    expect(parseInline("a **** b")).toEqual([text("a **** b")]);
  });

  it("lets code win over bold, as Markdown does", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ kind: "code", text: "**not bold**" }]);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs on blank lines and joins wrapped lines", () => {
    expect(parseBlocks("one\nstill one\n\ntwo")).toEqual([
      { kind: "paragraph", content: [text("one still one")] },
      { kind: "paragraph", content: [text("two")] },
    ]);
  });

  it("reads a heading", () => {
    expect(parseBlocks("## Finding")).toEqual([{ kind: "heading", content: [text("Finding")] }]);
  });

  it.each([
    ["- a\n- b", false],
    ["1. a\n2. b", true],
  ])("reads a list from %j", (input, ordered) => {
    const [block] = parseBlocks(input) as [Extract<Block, { kind: "list" }>];
    expect(block.kind).toBe("list");
    expect(block.ordered).toBe(ordered);
    expect(block.items).toHaveLength(2);
  });

  it("reads a pipe table with its separator row", () => {
    const [block] = parseBlocks(
      "| Region | n |\n| --- | --- |\n| VII | 3,891 |\n| IX | 1,204 |",
    ) as [Extract<Block, { kind: "table" }>];
    expect(block.kind).toBe("table");
    expect(block.header).toEqual([[text("Region")], [text("n")]]);
    expect(block.rows).toHaveLength(2);
    expect(block.rows[1]).toEqual([[text("IX")], [text("1,204")]]);
  });

  // Without requiring the separator, a sentence containing a pipe would open a one-column table.
  it("does not open a table for a pipe in prose", () => {
    expect(parseBlocks("| not a table").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("ends a table at the first non-table line", () => {
    const blocks = parseBlocks("| a |\n| --- |\n| 1 |\nafter");
    expect(blocks.map((b) => b.kind)).toEqual(["table", "paragraph"]);
  });

  /**
   * The security property, asserted rather than assumed. This module emits data, never markup, and
   * the two constructs that could carry a clickable or executable payload must come through as
   * plain text.
   */
  describe("never produces markup or links", () => {
    it("renders a link as its literal characters", () => {
      expect(parseBlocks("see [here](javascript:alert(1))")).toEqual([
        { kind: "paragraph", content: [text("see [here](javascript:alert(1))")] },
      ]);
    });

    it("renders raw HTML as text", () => {
      expect(parseBlocks("<script>alert(1)</script>")).toEqual([
        { kind: "paragraph", content: [text("<script>alert(1)</script>")] },
      ]);
    });

    it("emits no block kind that carries a URL", () => {
      const kinds = parseBlocks("## h\n\ntext **b** `c`\n\n- item\n\n| a |\n| --- |\n| 1 |").map(
        (b) => b.kind,
      );
      expect(new Set(kinds)).toEqual(new Set(["heading", "paragraph", "list", "table"]));
    });
  });

  // Losing a sentence to a formatting parser would be worse than losing its formatting.
  it("preserves every non-blank line's text somewhere in the output", () => {
    const source = "## Head\nprose\n- item\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    const flat = JSON.stringify(parseBlocks(source));
    for (const token of ["Head", "prose", "item", "a", "b", "1", "2"]) {
      expect(flat).toContain(token);
    }
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("   \n\n  ")).toEqual([]);
  });
});
