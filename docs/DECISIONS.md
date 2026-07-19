# Decisions log

Dated entries recording deviations from `docs/BUILD_PLAN.md` and judgment calls made during implementation.

---

## 2026-07-19 — Increment 0.1 kickoff

Scaffolded Next.js (App Router, TypeScript strict, Tailwind) at repo root via `create-next-app`, then merged in the folder skeleton from BUILD_PLAN.md §4.2 (empty directories tracked with `.gitkeep` pending their implementing increments). `dataset.parquet` moved to `ingestion/data/`. No deviations from the plan.

## 2026-07-19 — Increment 0.2: Supabase + Vercel provisioning

- Paused Supabase project `koica-journey-tracker` (ref `zmoybshitjcgeijiysoi`) to free a slot on the free tier, per §2/P4.
- Created Supabase project **`bhw-connect`** (ref `ejcuwrnxngdwvecxwrhy`) in org `rparoyuerqqrozxehztm`, region `ap-southeast-1`, confirmed $0/month. Project URL: `https://ejcuwrnxngdwvecxwrhy.supabase.co`.
- Created Vercel project **`bhw-connect`** under team `jongsky25's projects` (`team_wavZZVJXBgbZ6xwRdtgYQCi6`) via a direct file deploy (no git repo available to the deploy tool), confirming the scaffold builds and serves on Vercel. Production alias: `bhw-connect-rose.vercel.app`.

**Deviation:** the available Vercel MCP tooling can create a project and deploy files directly, but cannot link a project to a GitHub repository for auto-deploy-on-push, nor set environment variables. Both require the Vercel dashboard and are left as manual follow-up (tracked outside this doc, not a plan change — the target end state, a `main`-tracking Vercel project, is unchanged).
