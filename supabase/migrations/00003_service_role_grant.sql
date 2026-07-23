-- Service-role write access for the snapshot backfill script.
-- Already applied live via the Supabase SQL editor; committed here so the grant
-- is version-controlled alongside 00001/00002 and re-applies on a rebuild.
--
-- backend/scripts/snapshot_model_pick.py authenticates with the service-role
-- secret key to freeze the model's top-3 pick per race. service_role bypasses
-- RLS, but still needs the table-level privilege.

grant select, insert on public.model_snapshots to service_role;
