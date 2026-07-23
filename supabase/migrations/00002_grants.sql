-- Table privileges for the picks feature.
-- Already applied live via the Supabase SQL editor; committed here so the
-- grants are version-controlled and re-apply automatically when the database
-- is rebuilt from scratch.
--
-- The app signs users in anonymously, so its requests carry the `authenticated`
-- role. Row-level security still gates *which* rows each user can touch;
-- these GRANTs are the table-level prerequisite for that.

-- Players read/write their own predictions (row scoping enforced by RLS).
grant select, insert, update on public.predictions to authenticated;

-- Model snapshots are public read (both signed-in and pre-session visitors).
grant select on public.model_snapshots to authenticated, anon;
