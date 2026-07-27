-- SELECT privilege on public.predictions for the service-role key.
-- 00002 granted predictions to `authenticated` only (row-scoped by RLS); the
-- service-role key (which bypasses RLS) still needs the table-level privilege
-- to read user picks — e.g. for the Hungary pre-quali fairness check.
-- Already applied live via the Supabase SQL editor; committed here so the grant
-- is version-controlled alongside 00003/00005 and re-applies on a rebuild.

grant select on public.predictions to service_role;
