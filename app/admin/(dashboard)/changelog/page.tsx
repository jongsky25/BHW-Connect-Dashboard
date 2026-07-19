import { getChangelogEntries } from "@/lib/db/changelog";
import { addChangelogEntry } from "./actions";

export default async function AdminChangelogPage() {
  const entries = await getChangelogEntries();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">New entry</h2>
        <form action={addChangelogEntry} className="mt-2 flex flex-col gap-3">
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Title"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <textarea
            name="body"
            required
            maxLength={5000}
            rows={4}
            placeholder="What changed"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
          >
            Publish
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Published entries</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-muted">No changelog entries yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border p-4">
                <p className="text-xs text-muted">{new Date(entry.publishedAt).toLocaleDateString()}</p>
                <p className="font-medium">{entry.title}</p>
                <p className="text-sm text-muted">{entry.bodyMd}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
