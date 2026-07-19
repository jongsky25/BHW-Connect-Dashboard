# BHW Connect Dashboard

A public, open-access dashboard for the Philippine Barangay Health Worker (BHW) dataset — built for both lay and technical audiences, with WHO WPSAR-style figures, cascading geographic filters (national → region → province → city/municipality → barangay), interactive maps, purpose-built downloads (CSV/XLSX/PNG/PPTX), and (Phase 2) strictly data-grounded AI insights and chat.

**Status:** implementation in progress — Phase 0 (foundation).

## Repository contents

| Path                             | What it is                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ingestion/data/dataset.parquet` | Source data: 270,917 BHW records × 130 columns (2025 snapshot)                                                                                                                             |
| `docs/BUILD_PLAN.md`             | **The build reference** — approved architecture, phased/incremental roadmap, engineering standards, pitfall register, and launch checklist. All implementation work follows this document. |
| `docs/DECISIONS.md`              | Dated log of deviations from the build plan and implementation judgment calls.                                                                                                             |
| `app/`, `lib/`, `components/`    | Next.js App Router application (TypeScript strict, Tailwind).                                                                                                                              |
| `ingestion/`                     | Python ingestion pipeline (parquet → Supabase Postgres → aggregates); run locally/scripted, not deployed.                                                                                  |
| `supabase/migrations/`           | SQL schema migrations.                                                                                                                                                                     |

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test
```

## Key commitments

- **Free-tier only** hosting (Vercel Hobby + Supabase Free) and AI (multi-provider free tiers with auto-pause and graceful degradation — the dashboard never depends on AI availability).
- **Privacy by design:** small-cell suppression (n < 5) for individual-level breakdowns at barangay level; anonymized usage logging; RA 10173-aware privacy notice.
- **Open data:** published aggregates and downloads licensed under CC BY 4.0.
