-- Freeze the model's per-pick win/podium probabilities alongside the top-3
-- picks, so the "Me vs. Model" share card can show the FROZEN numbers rather
-- than a live /whatif re-query that could drift after the fact.
--
-- Apply live via the Supabase SQL editor, then re-run the snapshot script with
-- --force so existing rows get populated:
--   python backend/scripts/snapshot_model_pick.py --race-id 1179 --force ...
--
-- Nullable so pre-existing snapshot rows (picks only, no probabilities) stay
-- valid until they're re-snapshotted.

alter table public.model_snapshots
  add column if not exists p1_win    double precision,
  add column if not exists p1_podium double precision,
  add column if not exists p2_win    double precision,
  add column if not exists p2_podium double precision,
  add column if not exists p3_win    double precision,
  add column if not exists p3_podium double precision;
