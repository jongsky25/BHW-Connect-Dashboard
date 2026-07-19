-- Trigram search, used by dim_geo / agg_geo_summary search (increment 1.3: "find my barangay").
-- Installed into a dedicated schema, not `public`, per Supabase's extension placement guidance.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
