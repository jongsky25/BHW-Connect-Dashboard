# BHW Connect Dashboard

A public, open-access dashboard for the Philippine Barangay Health Worker (BHW) dataset — built for both lay and technical audiences, with WHO WPSAR-style figures, cascading geographic filters (national → region → province → city/municipality → barangay), interactive maps, purpose-built downloads (CSV/XLSX/PNG/PPTX), and (Phase 2) strictly data-grounded AI insights and chat.

**Status:** planning complete — implementation not yet started.

## Repository contents

| Path | What it is |
|---|---|
| `dataset.parquet` | Source data: 270,917 BHW records × 130 columns (2025 snapshot) |
| `docs/BUILD_PLAN.md` | **The build reference** — approved architecture, phased/incremental roadmap, engineering standards, pitfall register, and launch checklist. All implementation work follows this document. |

## Key commitments

- **Free-tier only** hosting (Vercel Hobby + Supabase Free) and AI (multi-provider free tiers with auto-pause and graceful degradation — the dashboard never depends on AI availability).
- **Privacy by design:** small-cell suppression (n < 5) for individual-level breakdowns at barangay level; anonymized usage logging; RA 10173-aware privacy notice.
- **Open data:** published aggregates and downloads licensed under CC BY 4.0.
