import { Fragment } from "react";
import { parseBlocks, type Inline } from "@/lib/ai/markdown-blocks";

/**
 * Renders an audited assistant answer (Increment 5.2). A thin renderer over `parseBlocks`, which
 * holds all the logic and is unit-tested in isolation — the `deck-logic.ts` split.
 *
 * Every string reaches the DOM as a React text child, so escaping is by construction rather than
 * by sanitising: there is no `dangerouslySetInnerHTML` here and no code path that builds a markup
 * string. `parseBlocks` emits no link node at all, so a URL the model wrote cannot become
 * clickable — the only trustworthy links on this page are the citation links the server emits
 * from the retrieval payload (2.3), and a model-authored one would be indistinguishable from them.
 */

function InlineRun({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>
          {node.kind === "bold" ? (
            <strong className="font-semibold">{node.text}</strong>
          ) : node.kind === "code" ? (
            <code className="rounded bg-surface px-1 font-mono text-[0.9em]">{node.text}</code>
          ) : (
            node.text
          )}
        </Fragment>
      ))}
    </>
  );
}

export function AnswerMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className="text-sm font-semibold">
              <InlineRun nodes={block.content} />
            </h3>
          );
        }

        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={i}
              className={`ml-5 flex flex-col gap-1 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <InlineRun nodes={item} />
                </li>
              ))}
            </List>
          );
        }

        if (block.kind === "table") {
          return (
            // A regional breakdown is wider than this panel; the table scrolls inside its own box
            // rather than stretching the chat column.
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th
                        key={j}
                        className="border-b border-border px-2 py-1 text-left font-semibold"
                      >
                        <InlineRun nodes={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k} className="border-b border-border px-2 py-1 align-top">
                          <InlineRun nodes={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={i}>
            <InlineRun nodes={block.content} />
          </p>
        );
      })}
    </div>
  );
}
