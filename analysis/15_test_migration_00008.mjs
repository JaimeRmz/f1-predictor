// Test supabase/migrations/00008_snapshot_immutability.sql on a THROWAWAY in-process Postgres (PGlite).
// Never touches Supabase or any network. The base table is not in the repo's migrations (it was
// created in the dashboard), so a minimal faithful version is created here; the REAL migration files
// 00003, 00004, 00005, 00007 and 00008 are then applied verbatim.
//
// Setup (outside the repo):   mkdir <tmp>/pglite-test && cd <tmp>/pglite-test && npm init -y && npm install @electric-sql/pglite
// Run:                        node analysis/15_test_migration_00008.mjs <tmp>/pglite-test
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.error('usage: node 15_test_migration_00008.mjs <dir with node_modules/@electric-sql/pglite>'); process.exit(2); }
const { PGlite } = await import(pathToFileURL(path.join(dir, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const mig = f => readFileSync(path.join(REPO, 'supabase', 'migrations', f), 'utf8');

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.model_snapshots (
    race_id integer primary key,
    predicted_p1 text not null, predicted_p2 text not null, predicted_p3 text not null,
    snapshotted_at timestamptz not null default now()
  );
  grant select on public.model_snapshots to authenticated, anon;   -- as 00002
`);
for (const f of ['00003_service_role_grant.sql', '00004_snapshot_probabilities.sql', '00005_service_role_update_grant.sql', '00007_snapshot_provenance.sql', '00008_snapshot_immutability.sql']) {
  await db.exec(mig(f)); console.log('applied', f);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${!cond && extra ? '  -> ' + extra : ''}`); };
const run = async (sql, role) => { if (role) await db.exec(`set role ${role}`); try { return { r: await db.query(sql) }; } catch (e) { return { e: String(e.message || e) }; } finally { if (role) await db.exec('reset role'); } };
const expectOk = async (name, sql, role) => { const x = await run(sql, role); ok(name, !x.e, x.e); return x; };
const expectErr = async (name, sql, re, role) => { const x = await run(sql, role); ok(name, !!x.e && re.test(x.e), x.e ? x.e : 'no error was raised'); return x; };

// the exact column set the pilot's snapshot_one() writes, with Brazil's real cutoff (a future instant today)
const PILOT = `insert into public.model_snapshots
  (race_id, predicted_p1, predicted_p2, predicted_p3, p1_win, p1_podium, p2_win, p2_podium, p3_win, p3_podium, model_version, git_commit, inputs_as_of_race_id, cutoff_at, source)
  values (1188,'antonelli','max_verstappen','russell',0.9576,0.9576,0.762,0.9174,0.0915,0.9052,'m-a6621e96c549','bc0df024',1187,'2026-11-07T18:00:00Z','whatif_auto_quali')`;
const now = (await db.query('select now() as n')).rows[0].n;
console.log('\nDatabase clock (the trigger compares against this):', now.toISOString ? now.toISOString() : now);

console.log('\n1. INSERT works');
await expectOk('INSERT as owner (open snapshot, cutoff in the future)', `insert into public.model_snapshots (race_id,predicted_p1,predicted_p2,predicted_p3,cutoff_at) values (1,'a','b','c', now() + interval '1 day')`);
await expectOk("INSERT as service_role using the pilot's exact column set (incl. cutoff_at)", PILOT, 'service_role');
const row = (await db.query(`select cutoff_at, model_version, source from public.model_snapshots where race_id=1188`)).rows[0];
ok('the pilot insert STORED cutoff_at = 2026-11-07T18:00:00Z', new Date(row.cutoff_at).toISOString() === '2026-11-07T18:00:00.000Z', JSON.stringify(row));
await expectOk('INSERT a row with cutoff in the past (for the frozen tests)', `insert into public.model_snapshots (race_id,predicted_p1,predicted_p2,predicted_p3,cutoff_at) values (2,'a','b','c','2000-01-01T00:00:00Z')`);
await expectOk('INSERT a row with NULL cutoff_at (a snapshot taken without --cutoff)', `insert into public.model_snapshots (race_id,predicted_p1,predicted_p2,predicted_p3) values (3,'a','b','c')`);

console.log('\n2. UPDATE before cutoff_at works');
await expectOk('UPDATE a non-key field on an OPEN snapshot as owner', `update public.model_snapshots set p1_win = 0.5 where race_id = 1`);
await expectOk("UPDATE as service_role on the pilot's open snapshot (the --force replacement path)", `update public.model_snapshots set predicted_p1 = 'russell', p1_win = 0.4 where race_id = 1188`, 'service_role');

console.log('\n3. UPDATE after cutoff_at is refused');
await expectErr('UPDATE a FROZEN row (cutoff passed) as owner', `update public.model_snapshots set p1_win = 0.1 where race_id = 2`, /frozen/i);
await expectErr('UPDATE a FROZEN row as service_role', `update public.model_snapshots set p1_win = 0.1 where race_id = 2`, /frozen/i, 'service_role');
await expectErr('UPSERT (INSERT ... ON CONFLICT DO UPDATE) on a frozen row', `insert into public.model_snapshots (race_id,predicted_p1,predicted_p2,predicted_p3) values (2,'x','y','z') on conflict (race_id) do update set predicted_p1 = excluded.predicted_p1`, /frozen/i);

console.log('\n4. race_id and cutoff_at cannot change on an open snapshot');
await expectErr('change race_id of an open snapshot', `update public.model_snapshots set race_id = 99 where race_id = 1`, /cannot be changed/i);
await expectErr('move cutoff_at LATER on an open snapshot (extend the deadline)', `update public.model_snapshots set cutoff_at = now() + interval '30 days' where race_id = 1`, /cannot be changed/i);
await expectErr('move cutoff_at EARLIER on an open snapshot', `update public.model_snapshots set cutoff_at = now() + interval '1 hour' where race_id = 1`, /cannot be changed/i);
await expectErr('set cutoff_at to NULL on an open snapshot', `update public.model_snapshots set cutoff_at = null where race_id = 1`, /cannot be changed/i);

console.log('\n5. DELETE is refused');
await expectErr('DELETE an OPEN snapshot as owner (trigger)', `delete from public.model_snapshots where race_id = 1`, /DELETE is not allowed/i);
await expectErr('DELETE a FROZEN snapshot as owner (trigger)', `delete from public.model_snapshots where race_id = 2`, /DELETE is not allowed/i);
await expectErr('DELETE as service_role (no grant: permission denied before the trigger)', `delete from public.model_snapshots where race_id = 1`, /permission denied/i, 'service_role');
await db.exec('grant delete on public.model_snapshots to service_role');
await expectErr('DELETE as service_role EVEN IF the grant existed (the trigger still refuses)', `delete from public.model_snapshots where race_id = 1`, /DELETE is not allowed/i, 'service_role');
await db.exec('revoke delete on public.model_snapshots from service_role');

console.log('\n6. NULL cutoff_at rows are frozen immediately');
await expectErr('UPDATE a row whose cutoff_at is NULL', `update public.model_snapshots set p1_win = 0.1 where race_id = 3`, /frozen.*NULL|NULL/i);

console.log('\n7. Edge cases and the escape hatch');
await expectOk('zero-row UPDATE (what the old access probe sent: race_id = -1) does not error: row-level triggers do not fire', `update public.model_snapshots set p1_win = 0 where race_id = -1`, 'service_role');
await expectOk('SELECT still works for anon', `select race_id from public.model_snapshots`, 'anon');
await db.exec('alter table public.model_snapshots disable trigger model_snapshots_frozen');
await expectOk('escape hatch: with the trigger DISABLED (SQL-editor superuser action) a frozen row can be corrected', `update public.model_snapshots set p1_win = 0.2 where race_id = 2`);
await db.exec('alter table public.model_snapshots enable trigger model_snapshots_frozen');
await expectErr('...and once RE-ENABLED the row is frozen again', `update public.model_snapshots set p1_win = 0.3 where race_id = 2`, /frozen/i);

console.log('\n8. Time boundary (cutoff passes while the row exists)');
await db.exec(`insert into public.model_snapshots (race_id,predicted_p1,predicted_p2,predicted_p3,cutoff_at) values (4,'a','b','c', now() + interval '2 seconds')`);
await expectOk('UPDATE just BEFORE the cutoff succeeds', `update public.model_snapshots set p1_win = 0.1 where race_id = 4`);
await new Promise(r => setTimeout(r, 2600));
await expectErr('the SAME update 2.6 s later (cutoff now passed) is refused', `update public.model_snapshots set p1_win = 0.2 where race_id = 4`, /frozen/i);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
