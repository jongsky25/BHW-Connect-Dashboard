import Link from "next/link";
import { loadReplayableCases } from "@/lib/db/regression-cases";
import { replaySuite, type CaseReplay } from "@/lib/ai/regression-runner";

/**
 * The §10 runner's surface (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * §10 asks for "a growing list of questions with known-correct answers, used to tell whether a
 * change — chunk size, retrieval count, prompt wording, traversal depth — made answers better or
 * worse", and is explicit that "three answers read by hand say nothing about the other forty".
 * Increment 2.4 built the list; this is what spends it.
 *
 * **It replays on request, not on load.** A replay re-issues every tool call every open case
 * recorded, which is real work against the database and grows with the list. A page that did it on
 * every visit would be a page people stop visiting, and §10 only works if the list is looked at.
 * So the default render is the inventory and the replay is a link.
 */
export default async function AdminRegressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  const cases = await loadReplayableCases();
  const suite = run === "1" ? await replaySuite(cases) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Regression cases</h2>
        <p className="mt-1 text-xs text-muted">
          Every case here was filed from a real answer someone marked wrong. Replaying re-issues the
          tool calls it recorded and re-resolves the passages it cited, against this build.
        </p>
      </div>

      {cases.length === 0 ? (
        <p className="text-sm text-muted">
          No open cases. Marking an assistant answer wrong files one, with the question, the tool
          calls and the citations behind it.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/regressions?run=1"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            Replay {cases.length} {cases.length === 1 ? "case" : "cases"}
          </Link>
          {suite && (
            <p className="text-xs text-muted">
              {suite.ok} ok · {suite.degraded} degraded · {suite.broken} broken
            </p>
          )}
        </div>
      )}

      {suite && (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          {suite.caveat}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {cases.map((stored) => {
          const replay = suite?.cases.find((r) => r.caseId === stored.caseId);
          return (
            <li key={stored.caseId} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                {replay && <Verdict verdict={replay.verdict} />}
                <p className="min-w-0 flex-1 text-sm font-medium">{stored.question}</p>
                <span className="font-mono text-[11px] text-muted">#{stored.caseId}</span>
              </div>
              {stored.note && (
                <p className="mt-1 text-xs text-muted">Should have said: {stored.note}</p>
              )}
              <p className="mt-1 font-mono text-[11px] text-muted">
                {stored.toolCalls.length} tool {stored.toolCalls.length === 1 ? "call" : "calls"} ·{" "}
                {stored.citations.length} cited
              </p>
              {replay && <ReplayDetail replay={replay} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Verdict({ verdict }: { verdict: CaseReplay["verdict"] }) {
  const style =
    verdict === "ok"
      ? "bg-accent-subtle text-accent"
      : verdict === "degraded"
        ? "bg-surface text-muted"
        : "bg-surface text-danger";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${style}`}>{verdict}</span>;
}

function ReplayDetail({ replay }: { replay: CaseReplay }) {
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {replay.findings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {replay.findings.map((finding, i) => (
            <li key={i} className="text-xs text-danger">
              {finding}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1 font-mono text-[11px]">
        {replay.toolCalls.map((call, i) => (
          <li key={i} className={call.status === "ok" ? "text-muted" : "text-danger"}>
            {call.name}({JSON.stringify(call.args)}) → {call.status}
            {call.chunkIds.length > 0 && ` · ${call.chunkIds.length} chunks`}
          </li>
        ))}
        {replay.citations.map((cite) => (
          <li
            key={cite.chunkId}
            className={
              cite.resolves &&
              cite.pageUnchanged &&
              cite.textUnchanged !== false &&
              cite.stillRetrieved
                ? "text-muted"
                : "text-danger"
            }
          >
            slide {cite.page} (chunk {cite.chunkId}) →{" "}
            {[
              cite.resolves ? "resolves" : "MISSING",
              cite.pageUnchanged ? "same page" : "moved",
              cite.textUnchanged === null
                ? "no text recorded"
                : cite.textUnchanged
                  ? "same text"
                  : "text changed",
              cite.stillRetrieved ? "still retrieved" : "not retrieved",
            ].join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
