import { GLOSSARY } from "@/lib/glossary/terms";

export const metadata = { title: "Glossary" };

export default function GlossaryPage() {
  const entries = Object.values(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Glossary</h1>
        <p className="mt-2 text-muted">
          Plain-language definitions for every technical term used on BHW Connect. Terms are also
          shown as underlined text with a tooltip wherever they appear in the app.
        </p>
      </div>
      <dl className="flex flex-col gap-4">
        {entries.map((entry) => (
          <div key={entry.term} className="border-b border-border pb-4">
            <dt className="font-semibold">{entry.term}</dt>
            <dd className="mt-1 text-sm text-muted">{entry.definition}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
