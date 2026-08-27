import { AssistantChat } from "@/components/admin/assistant-chat";
import { listRegisteredDatasets } from "@/lib/db/dataset-registry";
import { listOpenRegressionCases } from "@/lib/db/regression-cases";

/**
 * The internal assistant (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.4). Gated by the `(dashboard)`
 * layout's `getAdminAuthResult()` check, and never linked from public navigation; the API route it
 * calls re-checks the admin session itself, since a route handler is reachable without ever
 * loading this page.
 *
 * The catalogue is rendered server-side rather than fetched by the model on the client: what the
 * assistant can reach is a fact about the deployment that a staff reader should be able to see
 * before asking anything, not something to discover by being refused.
 */
export default async function AdminAssistantPage() {
  const [datasets, openCases] = await Promise.all([
    listRegisteredDatasets("internal"),
    listOpenRegressionCases(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Internal assistant</h2>
        <p className="text-xs text-muted">
          Admin-only. Reaches every registered dataset, keeps the numeric audit, and never uses the
          public answer cache — each question is answered live.
        </p>
      </div>

      <AssistantChat />

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {datasets.length} registered {datasets.length === 1 ? "dataset" : "datasets"} it can query
        </summary>
        {datasets.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            The registry is empty or unreachable — the assistant falls back to the built-in
            indicator tools.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {datasets.map((dataset) => (
              <li key={dataset.tableName} className="text-sm">
                <span className="font-mono text-xs">{dataset.tableName}</span> — {dataset.title}
                <span className="block text-xs text-muted">One row = {dataset.grain}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
      {/*
        Increment 2.4 (§10). The list is shown here rather than on a page of its own because it is
        only self-sustaining if the people who file cases can see the list growing — a report that
        vanishes into a table nobody reads is a report that stops being made.
      */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {openCases.length} open regression{" "}
          {openCases.length === 1 ? "case" : "cases"}
        </summary>
        {openCases.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing filed yet. Marking an answer wrong stores the question, the tool calls and the
            citations behind it, so it can be replayed against a later build.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {/* The list lives here because the people who file cases are the people looking at this
                page (2.4). Replaying them is a different job with its own page — it re-issues every
                recorded tool call, which is not something to do on a chat page render. */}
            <li className="text-xs text-muted">
              <a href="/admin/regressions" className="hover:underline">
                Replay these against this build →
              </a>
            </li>
            {openCases.map((entry) => (
              <li key={entry.caseId} className="border-l-2 border-border pl-3 text-sm">
                <p className="font-medium">{entry.question}</p>
                {entry.note ? (
                  <p className="text-xs text-muted">Should have said: {entry.note}</p>
                ) : (
                  <p className="text-xs text-muted">No expected answer recorded.</p>
                )}
                <p className="mt-1 font-mono text-[11px] text-muted">
                  #{entry.caseId} · {entry.provider ?? "no provider"} ·{" "}
                  {entry.toolNames.length > 0 ? entry.toolNames.join(", ") : "no tool calls"}
                  {entry.citationCount > 0 && ` · ${entry.citationCount} cited`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
