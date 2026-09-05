import Link from "next/link";
import { districtOrdinalLabel } from "@/components/districts/district-ordinal";
import { formatIndicatorValue } from "@/lib/analysis/map-indicators";

export type DistrictCompareColumnData = {
  districtCode: string;
  districtName: string;
  regionName: string | null;
  ordinal: number | null;
  isLone: boolean;
  memberCount: number;
  population: number | null;
  pctAccredited: number | null;
  avgActiveYears: number | null;
  anyHonorariumPct: number | null;
  nTotal: number | null;
};

/**
 * D3.3 — one district's column in district-vs-district compare. Deliberately much thinner than
 * `CompareColumn` (places get demographics/training/certification/honorarium tabs; a district gets
 * only the 3 figures `agg_bhw_by_district` carries — see that table's own comment for why). The
 * head-to-head strip above already does the cross-district benchmark bars, so this column is the
 * per-district reference card: identity facts plus the same 3 numbers, and a link to the full
 * per-row receipt (`/districts/[code]`, D2.2/D3.3) for everything else — members, sources,
 * corrections.
 */
export function DistrictCompareColumn({ data }: { data: DistrictCompareColumnData }) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:w-72">
      <div>
        <Link
          href={`/districts/${data.districtCode}`}
          className="text-lg font-semibold tracking-tight underline hover:text-accent"
        >
          {data.districtName}
        </Link>
        <p className="mt-1 text-xs text-muted">
          {districtOrdinalLabel(data)}
          {data.regionName ? ` · ${data.regionName}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Member LGUs</dt>
          <dd className="font-medium">{data.memberCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">PSA population</dt>
          <dd className="font-medium">{data.population !== null ? data.population.toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">% accredited</dt>
          <dd className="font-medium">
            {data.pctAccredited !== null ? formatIndicatorValue(data.pctAccredited, "%") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Avg years of service</dt>
          <dd className="font-medium">
            {data.avgActiveYears !== null ? formatIndicatorValue(data.avgActiveYears, "") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Any-honorarium %</dt>
          <dd className="font-medium">
            {data.anyHonorariumPct !== null ? formatIndicatorValue(data.anyHonorariumPct, "%") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Total BHWs</dt>
          <dd className="font-medium">{data.nTotal !== null ? data.nTotal.toLocaleString() : "—"}</dd>
        </div>
      </dl>

      <Link href={`/districts/${data.districtCode}`} className="text-sm underline hover:text-accent">
        Full receipt: members, sources &amp; corrections →
      </Link>
    </div>
  );
}
