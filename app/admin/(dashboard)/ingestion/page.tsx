import { listIngestionBatches } from "@/lib/db/admin";

export default async function AdminIngestionPage() {
  const batches = await listIngestionBatches();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Ingestion history</h2>
      {batches.length === 0 ? (
        <p className="text-muted">No ingestion batches recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((batch) => (
            <li key={batch.batchId} className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{batch.sourceFile ?? "(unknown source file)"}</p>
              <p className="text-xs text-muted">
                Started {new Date(batch.startedAt).toLocaleString()}
                {batch.finishedAt ? ` · finished ${new Date(batch.finishedAt).toLocaleString()}` : " · in progress"}
              </p>
              {batch.rowCounts != null && (
                <pre className="mt-2 overflow-x-auto rounded-md bg-surface p-2 text-xs">
                  {JSON.stringify(batch.rowCounts, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
