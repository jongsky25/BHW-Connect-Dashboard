import {
  getAskCacheSavings,
  listAskBank,
  listFrequentQuestions,
  type AskBankRow,
  type AskBankStatus,
} from "@/lib/db/ask-bank";
import { deleteAskEntry, editAskAnswer, setAskStatus } from "./actions";

const STATUS_LABEL: Record<AskBankStatus, string> = { auto: "Auto", approved: "Approved", blocked: "Blocked" };
const STATUS_STYLE: Record<AskBankStatus, string> = {
  auto: "bg-surface text-muted",
  approved: "bg-accent-subtle text-accent",
  blocked: "bg-surface text-danger",
};

/** Status buttons offered for a row, excluding its current one. Approve/block/reset covers the
 * plan's curation actions (§6 A3.2); reset returns an entry to lazy auto-regeneration. */
const STATUS_ACTIONS: Record<AskBankStatus, { status: AskBankStatus; label: string }[]> = {
  auto: [
    { status: "approved", label: "Approve" },
    { status: "blocked", label: "Block" },
  ],
  approved: [
    { status: "auto", label: "Reset to auto" },
    { status: "blocked", label: "Block" },
  ],
  blocked: [
    { status: "approved", label: "Approve" },
    { status: "auto", label: "Reset to auto" },
  ],
};

function scopeLabel(geoCode: string | null): string {
  return geoCode ?? "national";
}

export default async function AdminAnswerBankPage() {
  const [bank, frequent, savings] = await Promise.all([
    listAskBank(),
    listFrequentQuestions(),
    getAskCacheSavings(),
  ]);

  const totalChat = savings.liveMessages + savings.cacheHits;
  const hitRate = totalChat > 0 ? Math.round((savings.cacheHits / totalChat) * 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Answer bank</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted">Cache hits — last 30 days</p>
            <p className="mt-1 text-2xl font-semibold">{savings.cacheHits.toLocaleString()}</p>
            <p className="mt-1 text-xs text-muted">answered with no AI credit</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted">Live chat calls — last 30 days</p>
            <p className="mt-1 text-2xl font-semibold">{savings.liveMessages.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted">Hit rate</p>
            <p className="mt-1 text-2xl font-semibold">{hitRate}%</p>
            <p className="mt-1 text-xs text-muted">of chat turns served from the bank</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Stored answers ({bank.length})</h3>
        <p className="text-xs text-muted">
          Sorted by hits. Every entry passed the numeric audit before being stored. Approve to pin
          an answer (write-back can&apos;t overwrite it); block to force the question always to a
          live AI call; delete to let a bad entry be recaptured fresh on the next ask.
        </p>
        {bank.length === 0 ? (
          <p className="text-muted">No stored answers yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {bank.map((row) => (
              <AnswerBankItem key={row.cacheKey} row={row} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Most-asked questions — last 30 days</h3>
        <p className="text-xs text-muted">
          From the capture log, grouped by normalized question. Shows demand — the questions worth
          curating and keeping warm.
        </p>
        {frequent.length === 0 ? (
          <p className="text-muted">No questions logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-4 font-medium">Question</th>
                <th className="py-1 pr-4 font-medium">Asks</th>
                <th className="py-1 pr-4 font-medium">From cache</th>
                <th className="py-1 font-medium">Scopes</th>
              </tr>
            </thead>
            <tbody>
              {frequent.map((g) => (
                <tr key={g.questionNorm} className="border-t border-border align-top">
                  <td className="py-1 pr-4">{g.sample}</td>
                  <td className="py-1 pr-4 font-medium">{g.asks}</td>
                  <td className="py-1 pr-4">{g.servedFromCache}</td>
                  <td className="py-1 text-xs text-muted">{g.geoScopes.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AnswerBankItem({ row }: { row: AskBankRow }) {
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        <span className="font-medium text-foreground">{row.hitCount} hits</span>
        <span>· scope {scopeLabel(row.geoCode)}</span>
        {row.provider && <span>· {row.provider}</span>}
        <span>· generated {new Date(row.generatedAt).toLocaleDateString()}</span>
      </div>

      <p className="mt-2 text-sm font-medium">{row.questionDisplay}</p>

      <form action={editAskAnswer} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="cacheKey" value={row.cacheKey} />
        <textarea
          name="answerMd"
          defaultValue={row.answerMd}
          rows={3}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            Save &amp; approve
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS[row.status].map((action) => (
          <form key={action.status} action={setAskStatus}>
            <input type="hidden" name="cacheKey" value={row.cacheKey} />
            <input type="hidden" name="status" value={action.status} />
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface"
            >
              {action.label}
            </button>
          </form>
        ))}
        <form action={deleteAskEntry}>
          <input type="hidden" name="cacheKey" value={row.cacheKey} />
          <button
            type="submit"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-danger hover:bg-surface"
          >
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
