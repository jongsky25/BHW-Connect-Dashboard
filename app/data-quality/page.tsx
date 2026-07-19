import { getDataCompleteness } from "@/lib/db/data-quality";
import { getActiveDataset } from "@/lib/db/dataset";

export const metadata = { title: "Data quality" };

const FIELD_LABEL: Record<string, string> = {
  active_years: "Active-service years",
  civil_status: "Civil status",
  age: "Age",
  bloodtype: "Blood type",
  sex: "Sex",
  ip_status: "Indigenous people (IP) status",
  household: "Household count",
  educational_attainment: "Educational attainment",
};

export default async function DataQualityPage() {
  const [rows, dataset] = await Promise.all([getDataCompleteness(), getActiveDataset()]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data quality</h1>
        <p className="mt-2 text-muted">
          BHW Connect publishes what the source dataset actually contains, gaps included. This
          page shows what&apos;s complete and what isn&apos;t, so a missing number reads as a
          known finding rather than a hidden one.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted">Completeness figures are temporarily unavailable.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface">
              <tr>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Records missing</th>
                <th className="px-4 py-3 font-medium">% missing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.fieldName} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{FIELD_LABEL[row.fieldName] ?? row.fieldName}</td>
                  <td className="px-4 py-3">{row.nMissing?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-3">{row.pctMissing ?? "—"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        Computed from the {dataset?.asOfDate ?? "2025"} snapshot across all 270,917 records. Fields
        not listed here had no missingness worth tracking separately.
      </p>
    </div>
  );
}
