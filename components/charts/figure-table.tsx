import type { BarDatum } from "@/lib/charts/bar-chart";

/** Accessible table rendering of the same {label, value} data a bar chart draws — the
 * chart -> table toggle body, styled like app/data-quality/page.tsx's table. */
export function FigureTable({
  data,
  labelHeader = "Category",
  valueHeader = "Value",
  valueFormatter = (n: number) => n.toLocaleString(),
}: {
  data: BarDatum[];
  labelHeader?: string;
  valueHeader?: string;
  valueFormatter?: (n: number) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface">
          <tr>
            <th className="px-4 py-3 font-medium">{labelHeader}</th>
            <th className="px-4 py-3 font-medium">{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label} className="border-b border-border last:border-0">
              <td className="px-4 py-3">{d.label}</td>
              <td className="px-4 py-3">{valueFormatter(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
