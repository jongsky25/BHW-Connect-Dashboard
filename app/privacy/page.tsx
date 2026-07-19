export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-muted">
          What BHW Connect collects, why, and how it&apos;s protected — consistent with the Philippine
          Data Privacy Act (RA 10173).
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <p>When you use this site, we log anonymized usage events: which page you viewed, which filters you changed, what you searched for, and what you exported. Each event is tied to a random session ID generated in your browser, not to you personally.</p>
        <p>Your IP address is never stored. A salted, truncated one-way hash of it is kept alongside each event, only to help distinguish separate visitors in aggregate — it cannot be reversed back to your real IP.</p>
        <p>If you submit feedback, we store your message, the category you chose, the page you were on, and — only if you choose to provide it — your email address, so we can reply.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What we don&apos;t collect</h2>
        <p>No third-party analytics or advertising trackers. No cookies used for tracking across sites. No account or login is required to use the dashboard.</p>
        <p>Your browser sends a Do Not Track signal? We honor it — no usage events are logged at all.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The underlying BHW dataset</h2>
        <p>
          The published dashboard never shows or exports individual-level BHW records — only
          aggregate counts and percentages, with small groups suppressed to prevent
          re-identification. See{" "}
          <a href="/methodology" className="underline hover:text-accent">
            methodology
          </a>{" "}
          for the exact rule.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Retention</h2>
        <p>Usage events are kept in raw form for a limited period and then aggregated and purged. Feedback submissions are retained to track and resolve the issue raised.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Questions</h2>
        <p>
          Reach out via the{" "}
          <a href="/feedback" className="underline hover:text-accent">
            feedback
          </a>{" "}
          page with any privacy question or concern.
        </p>
      </section>
    </div>
  );
}
