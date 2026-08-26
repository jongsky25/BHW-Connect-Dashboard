import { AssistantChat } from "@/components/admin/assistant-chat";
import { listRegisteredDatasets } from "@/lib/db/dataset-registry";

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
  const datasets = await listRegisteredDatasets("internal");

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
    </div>
  );
}
