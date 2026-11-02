-- Provenance for frozen model snapshots: WHICH model produced the pick, from
-- WHICH inputs, against WHICH cutoff. Without these a snapshot is just three
-- names; with them it is auditable ("was this frozen before qualifying, by
-- the model in force, on the data we had?").
--
-- NOT yet applied live -- run it in the Supabase SQL editor. Until then
-- snapshot_model_pick.py inserts without these columns (and prints a warning)
-- rather than failing, so applying this is safe at any time and is not on the
-- critical path of a cutoff.
--
-- All nullable so the 14 existing rows stay valid. snapshotted_at already
-- records WHEN the row was written.

alter table public.model_snapshots
  add column if not exists model_version         text,         -- sha256 prefix of the model artifacts (API /meta)
  add column if not exists git_commit            text,         -- deployed commit serving the prediction, if known
  add column if not exists inputs_as_of_race_id  integer,      -- newest race in the data the model saw
  add column if not exists cutoff_at             timestamptz,  -- the real cutoff this was frozen against
  add column if not exists source                text;         -- whatif_auto_quali (pre-race) | predict_real_grid (hindsight)

comment on column public.model_snapshots.source is
  'whatif_auto_quali = genuine pre-qualifying forecast; predict_real_grid = computed on the real grid (not a foresight pick)';
