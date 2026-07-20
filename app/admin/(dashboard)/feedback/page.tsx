import { listFeedback, getFeedbackScreenshotUrl, type FeedbackStatus } from "@/lib/db/admin";
import { setFeedbackStatus } from "./actions";

const STATUS_LABEL: Record<FeedbackStatus, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
const OTHER_STATUSES: Record<FeedbackStatus, FeedbackStatus[]> = {
  open: ["resolved", "dismissed"],
  resolved: ["open", "dismissed"],
  dismissed: ["open", "resolved"],
};

export default async function AdminFeedbackPage() {
  const feedback = await listFeedback();
  // Resolve short-lived signed URLs for any screenshots up front (server-side).
  const screenshotUrls = await Promise.all(feedback.map((f) => getFeedbackScreenshotUrl(f.screenshotPath)));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Feedback</h2>
      {feedback.length === 0 ? (
        <p className="text-muted">No feedback yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feedback.map((item, i) => {
            const screenshotUrl = screenshotUrls[i];
            const isSpot = Boolean(item.targetSelector || item.pageUrl || item.screenshotPath);
            return (
              <li key={item.id} className="rounded-lg border border-border p-4">
                <p className="text-xs text-muted">
                  {new Date(item.createdAt).toLocaleString()} · {item.category} · {item.pagePath}
                  {isSpot && <span className="ml-1 rounded bg-accent-subtle px-1 text-accent">spot</span>} ·{" "}
                  <span className="font-medium">{STATUS_LABEL[item.status]}</span>
                </p>
                <p className="mt-2 text-sm">{item.message}</p>
                {item.email && <p className="mt-1 text-xs text-muted">Contact: {item.email}</p>}

                {isSpot && (
                  <div className="mt-2 flex flex-col gap-1 rounded-md bg-surface p-2 text-xs text-muted">
                    {item.pageUrl && (
                      <p className="truncate">
                        URL:{" "}
                        <a href={item.pageUrl} className="text-accent underline" target="_blank" rel="noreferrer">
                          {item.pageUrl}
                        </a>
                      </p>
                    )}
                    {item.targetSelector && (
                      <p>
                        Element: <code className="text-foreground">{item.targetSelector}</code>
                      </p>
                    )}
                    {item.context?.elementText && <p>Text: “{item.context.elementText}”</p>}
                    {item.context?.viewport?.w && item.context?.viewport?.h && (
                      <p>
                        Viewport: {item.context.viewport.w}×{item.context.viewport.h}
                      </p>
                    )}
                    {screenshotUrl && (
                      <a href={screenshotUrl} target="_blank" rel="noreferrer" className="mt-1">
                        {/* Signed URL from a private bucket; expires shortly. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={screenshotUrl}
                          alt="Feedback screenshot"
                          className="max-h-48 rounded border border-border"
                        />
                      </a>
                    )}
                  </div>
                )}

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
            );
          })}
        </ul>
      )}
    </div>
  );
}
