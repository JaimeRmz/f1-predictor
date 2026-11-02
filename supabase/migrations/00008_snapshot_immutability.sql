-- Make frozen snapshots tamper-evident: once a snapshot's cutoff has passed (or
-- if it has no recorded cutoff), its row can no longer be changed or deleted --
-- by ANY role, including the service key.
--
-- Why a trigger and not an RLS policy: the service_role key bypasses RLS, so a
-- policy cannot restrict it. A trigger fires for every role. (A superuser in the
-- Supabase SQL editor can still `alter table ... disable trigger`, which is the
-- deliberate, visible escape hatch for a genuine correction.)
--
-- Rules:
--   DELETE  never allowed.
--   UPDATE  allowed only BEFORE the row's recorded cutoff_at, and only if the
--           update does not move race_id or cutoff_at. That keeps the existing
--           "replace the pick with --force while the cutoff is still ahead of
--           you" workflow, and nothing after it. Rows with cutoff_at NULL (all
--           14 existing rows, and any snapshot taken without --cutoff) are
--           immutable immediately.
--
-- Depends on 00007 (cutoff_at). NOT yet applied live. Additive: one function and
-- one trigger; no RLS, grant, or column changes. Untested against a database
-- (no Postgres was available where this was written) -- run it on a copy or
-- review it before applying.
--
-- Side effect to know about: the 10 backfilled rows (races 1169-1178) have no
-- win/podium probabilities and, once this is applied, can never be re-snapshotted.
-- That is intended: they were created after the fact and must stay as they are.

create or replace function public.model_snapshots_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'model_snapshots rows are frozen: DELETE is not allowed (race_id=%)', old.race_id
      using hint = 'To correct a genuine mistake, disable trigger model_snapshots_frozen in the SQL editor, fix it, and re-enable it.';
  end if;

  -- UPDATE
  if old.cutoff_at is null or now() >= old.cutoff_at then
    raise exception 'model_snapshots row for race_id=% is frozen (cutoff % has passed or was not recorded)',
      old.race_id, coalesce(old.cutoff_at::text, 'NULL')
      using hint = 'To correct a genuine mistake, disable trigger model_snapshots_frozen in the SQL editor, fix it, and re-enable it.';
  end if;

  if new.race_id is distinct from old.race_id or new.cutoff_at is distinct from old.cutoff_at then
    raise exception 'model_snapshots: race_id and cutoff_at cannot be changed on an open snapshot';
  end if;

  return new;
end;
$$;

drop trigger if exists model_snapshots_frozen on public.model_snapshots;
create trigger model_snapshots_frozen
  before update or delete on public.model_snapshots
  for each row execute function public.model_snapshots_guard();
