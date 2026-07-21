import { FigureCard } from "@/components/narrative/figure-card";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { IncomeClassRow } from "@/lib/db/derived-figures";
import { formatPeso } from "@/lib/format";

const CLASS_LABEL: Record<number, string> = {
  1: "1st (highest income)",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
  6: "6th (lowest income)",
};

const MIN_CLASS_N = 5000; // below this a class's national figures are thin — flag it.

/**
 * Income-class equity (E3.7): do lower-income LGUs support their BHWs less?
 * National-scope indicator medians grouped by the city/municipality income class
 * each BHW's barangay belongs to. Uses only internal data (dim_geo.income_class);
 * E4.3 will refresh those classes from the 2024 DOF/BLGF reclassification. Only
 * rendered at the national view.
 */
export function IncomeClassFigure({ rows, caption }: { rows: IncomeClassRow[]; caption: string }) {
  const withHonorarium = rows.filter((r) => r.medianHonorariumAmount !== null);
  const maxMedian = Math.max(0, ...withHonorarium.map((r) => r.medianHonorariumAmount as number));

  const richest = rows.find((r) => r.incomeClass === 1);
  const poorer = rows.filter((r) => r.incomeClass >= 4 && r.medianHonorariumAmount !== null);
  const poorerAvg =
    poorer.length > 0
      ? poorer.reduce((s, r) => s + (r.medianHonorariumAmount as number), 0) / poorer.length
      : null;

  const headline =
    richest?.medianHonorariumAmount != null && poorerAvg != null
      ? poorerAvg < (richest.medianHonorariumAmount as number)
        ? `BHWs in the highest-income LGUs receive a higher median honorarium (${formatPeso(richest.medianHonorariumAmount)}) than those in lower-income ones.`
        : `BHWs in lower-income LGUs do not receive a smaller median honorarium than those in the highest-income ones.`
      : "Honorarium and accreditation by LGU income class.";

  return (
    <FigureCard
      title="BHW support by LGU income class"
      caption={caption}
      headline={headline}
      technicalDetails={
        <>
          <p>
            Each BHW is grouped by the income class of the city/municipality their barangay belongs
            to (<GlossaryTerm slug="income_class">income class</GlossaryTerm>: 1st is the
            highest-income, 6th the lowest). Accreditation and any-honorarium shares are pooled
            across all BHWs in that class; the honorarium amount is the median monthly honorarium
            among recipients in that class.
          </p>
          <p>
            Income classes are the values currently in the dataset; a later update will refresh them
            from the 2024 DOF/BLGF reclassification. Classes with fewer than{" "}
            {MIN_CLASS_N.toLocaleString()} profiled BHWs are marked as thin — their figures move a
            lot on relatively few people.
          </p>
        </>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface">
            <tr>
              <th className="px-3 py-2 font-medium sm:px-4">Income class</th>
              <th className="px-3 py-2 font-medium sm:px-4">BHWs</th>
              <th className="px-3 py-2 font-medium sm:px-4">% accredited</th>
              <th className="px-3 py-2 font-medium sm:px-4">% any honorarium</th>
              <th className="px-3 py-2 font-medium sm:px-4">Median honorarium/mo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const thin = r.nBhw < MIN_CLASS_N;
              const barPct =
                r.medianHonorariumAmount !== null && maxMedian > 0
                  ? (r.medianHonorariumAmount / maxMedian) * 100
                  : 0;
              return (
                <tr key={r.incomeClass} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 sm:px-4">
                    {CLASS_LABEL[r.incomeClass] ?? `Class ${r.incomeClass}`}
                    {thin && <span className="ml-1 text-xs text-muted">(thin)</span>}
                  </td>
                  <td className="px-3 py-2 sm:px-4">{r.nBhw.toLocaleString()}</td>
                  <td className="px-3 py-2 sm:px-4">
                    {r.pctAccredited !== null ? `${r.pctAccredited}%` : "—"}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    {r.anyHonorariumPct !== null ? `${r.anyHonorariumPct}%` : "—"}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2 rounded-sm"
                        style={{
                          width: `${Math.max(barPct, r.medianHonorariumAmount !== null ? 4 : 0)}%`,
                          minWidth: r.medianHonorariumAmount !== null ? "0.5rem" : 0,
                          backgroundColor: "var(--seq-4)",
                        }}
                      />
                      <span className="tabular-nums">{formatPeso(r.medianHonorariumAmount)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </FigureCard>
  );
}
