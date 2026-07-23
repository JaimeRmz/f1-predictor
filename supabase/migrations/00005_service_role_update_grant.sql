-- UPDATE privilege for the snapshot script's --force re-snapshots (which PATCH
-- an existing model_snapshots row). 00003 granted select+insert but missed
-- update, so --force failed until this was added.
-- Already applied live via the Supabase SQL editor; committed here so the grant
-- is version-controlled alongside 00003/00004.

grant update on public.model_snapshots to service_role;
