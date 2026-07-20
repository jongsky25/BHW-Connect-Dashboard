import { FigureCard } from "@/components/narrative/figure-card";
import { BarChartClient } from "@/components/charts/bar-chart-client";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { CertificationRow } from "@/lib/db/indicators";

const CERT_LABEL: Record<string, string> = {
  ref_manual_trained: "BHW Reference Manual Training",
  tesda_nc2: "TESDA BHS NC II Training",
  tesda_certified: "TESDA BHS NC II Certification",
};

// Display order follows the competency progression: reference-manual training →
// TESDA NC II training → TESDA NC II certification.
const CERT_ORDER = ["ref_manual_trained", "tesda_nc2", "tesda_certified"];

export function CertificationFigure({ rows, caption }: { rows: CertificationRow[]; caption: string }) {
  const byType = new Map(rows.map((r) => [r.certType, r]));
  const chartData = CERT_ORDER.map((t) => byType.get(t))
    .filter((r): r is CertificationRow => !!r && r.pct !== null)
    .map((r) => ({ label: CERT_LABEL[r.certType] ?? r.certType, value: r.pct as number }));

  const refManual = byType.get("ref_manual_trained");
  const certified = byType.get("tesda_certified");

  return (
    <FigureCard
      title="Training & certification coverage"
      caption={caption}
      headline={
        refManual?.pct != null && certified?.pct != null
          ? `${Math.round(refManual.pct)}% have completed BHW Reference Manual training, but only ${Math.round(certified.pct)}% hold TESDA BHS NC II certification.`
          : chartData.length > 0
            ? "Competency-based training and certification remain limited."
            : "No training or certification data available."
      }
      technicalDetails={
        <>
          <p>
            <GlossaryTerm slug="ref_manual_trained">BHW Reference Manual Training</GlossaryTerm>,{" "}
            <GlossaryTerm slug="tesda_nc2">TESDA BHS NC II Training</GlossaryTerm>, and{" "}
            <GlossaryTerm slug="tesda_certified">TESDA BHS NC II Certification</GlossaryTerm> are
            tracked independently; a BHW may have any combination of the three.
          </p>
          <p>Percentages are of the validated profiles in this area.</p>
        </>
      }
    >
      {chartData.length > 0 ? (
        <BarChartClient
          data={chartData}
          xLabel="% of BHWs"
          yLabel="Training / certification"
          valueSuffix="%"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
