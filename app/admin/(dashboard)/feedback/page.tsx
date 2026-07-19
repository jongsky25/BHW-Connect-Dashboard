import { listFeedback, type FeedbackStatus } from "@/lib/db/admin";
import { setFeedbackStatus } from "./actions";

const STATUS_LABEL: Record<FeedbackStatus, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
const OTHER_STATUSES: Record<FeedbackStatus, FeedbackStatus[]> = {
  open: ["resolved", "dismissed"],
  resolved: ["open", "dismissed"],
  dismissed: ["open", "resolved"],
};

export default async function AdminFeedbackPage() {
  const feedback = await listFeedback();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Feedback</h2>
      {feedback.length === 0 ? (
        <p className="text-muted">No feedback yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feedback.map((item) => (
            <li key={item.id} className="rounded-lg border border-border p-4">
              <p className="text-xs text-muted">
                {new Date(item.createdAt).toLocaleString()} · {item.category} · {item.pagePath} ·{" "}
                <span className="font-medium">{STATUS_LABEL[item.status]}</span>
              </p>
              <p className="mt-2 text-sm">{item.message}</p>
              {item.email && <p className="mt-1 text-xs text-muted">Contact: {item.email}</p>}
              <form action={setFeedbackStatus} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={item.id} />
                {OTHER_STATUSES[item.status].map((s) => (
                  <button
                    key={s}
                    type="submit"
                    name="status"
                    value={s}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface"
                  >
                    Mark {STATUS_LABEL[s].toLowerCase()}
                  </button>
                ))}
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
