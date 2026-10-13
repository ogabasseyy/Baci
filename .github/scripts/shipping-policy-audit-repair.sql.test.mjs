import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const original = read('supabase/migrations/20260921100200_enforce_merchant_shipping_provider_policy.sql');
const repair = read('supabase/migrations/20260926130000_repair_shipping_provider_policy_audit.sql');
const fixture = read('supabase/tests/shipping_policy_audit_repair_fixture.sql');
const writer = read('supabase/migrations/20260730000002_harden_canonical_audit_actor_inputs.sql');

test('repair registration pins the unchanged failed source and preserves policy SQL', () => {
  const digest = createHash('sha256').update(original).digest('hex');
  const spec = execFileSync('bash', ['-c', '. .github/scripts/historical-migration-repair-spec.sh; historical_migration_repair_spec 20260921100200 enforce_merchant_shipping_provider_policy'], { encoding: 'utf8' }).trim();
  assert.equal(spec, `20260926130000\trepair_shipping_provider_policy_audit\t${digest}`);
  const marker = '-- Checkout already';
  assert.ok(repair.includes(original.slice(original.indexOf(marker))));
  const update = original.slice(original.indexOf('WITH normalized_provider_settings'), original.indexOf('\n\n-- Checkout already'));
  assert.ok(repair.includes(update));
});

test('PostgreSQL reproduces missing actor, audits repair, restores claims, and remains idempotent', () => {
  const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'shipping-audit-postgres-'));
  let running = false;
  try {
    execFileSync(join(bin, 'initdb'), ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '-U', 'postgres'], { stdio: 'pipe' });
    execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 65438`, '-w', 'start'], { stdio: 'pipe' });
    running = true;
    const query = (sql) => execFileSync(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', '65438', '-U', 'postgres', '-d', 'postgres', '-qAt'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    query(`${fixture}\n${writer}`);
    assert.throws(() => query(`BEGIN;\n${original}\nCOMMIT;`), /audit_actor_required/);
    assert.equal(query('SELECT count(*) FROM public.audit_events'), '0');
    query("INSERT INTO supabase_migrations.schema_migrations VALUES ('20260921100200', 'unexpected_name')");
    assert.throws(() => query(repair), /shipping_policy_migration_history_conflict/);
    query('DELETE FROM supabase_migrations.schema_migrations');
    query("ALTER TABLE public.audit_events ADD CONSTRAINT reject_service_fixture CHECK (actor_type <> 'service')");
    assert.throws(() => query(`BEGIN;\n${repair}\nCOMMIT;`), /reject_service_fixture/);
    assert.equal(query('SELECT count(*) FROM public.audit_events'), '0');
    assert.equal(query("SELECT shipping_providers FROM public.merchant_feature_settings WHERE id='30000000-0000-4000-8000-000000000001'"), '[" GIGL ", "shiip", "topship", "gigl"]');
    query('ALTER TABLE public.audit_events DROP CONSTRAINT reject_service_fixture');

    assert.equal(query(`BEGIN; SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000001"}', true); SELECT set_config('request.jwt.claim.role', 'authenticated', true);\n${repair}\nSELECT current_setting('request.jwt.claims'), current_setting('request.jwt.claim.role'); COMMIT;`).split('\n').at(-1), '{"role":"authenticated","sub":"40000000-0000-4000-8000-000000000001"}|authenticated');
    assert.equal(query('SELECT actor_type, actor_label, actor_user_id IS NULL FROM public.audit_events'), 'service|service_role|t');
    assert.equal(query("SELECT shipping_providers FROM public.merchant_feature_settings WHERE id='30000000-0000-4000-8000-000000000001'"), '["gigl", "topship"]');
    assert.equal(query('SELECT count(*) FROM public.audit_events'), '1');
    query(`BEGIN;\n${repair}\nCOMMIT;`);
    assert.equal(query('SELECT count(*) FROM public.audit_events'), '1');
    query("INSERT INTO supabase_migrations.schema_migrations VALUES ('20260921100200', 'enforce_merchant_shipping_provider_policy')");
    const later = read('supabase/migrations/20260923123000_allow_stale_shipping_quote_clear.sql');
    query(later);
    const triggerBefore = query("SELECT pg_get_functiondef('private.enforce_merchant_shipping_provider_enabled()'::regprocedure)");
    query(repair);
    assert.equal(query("SELECT pg_get_functiondef('private.enforce_merchant_shipping_provider_enabled()'::regprocedure)"), triggerBefore);
    assert.throws(() => query("UPDATE public.merchant_feature_settings SET shipping_providers='[]' WHERE id='30000000-0000-4000-8000-000000000001'"), /audit_actor_required/);
    query("INSERT INTO public.orders VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000000001', 'gigl', gen_random_uuid(), 'delivery')");
    assert.throws(() => query("INSERT INTO public.orders VALUES (gen_random_uuid(), '20000000-0000-4000-8000-000000000001', 'shiip', gen_random_uuid(), 'delivery')"), /shipping_quote_required/);
  } finally {
    if (running) execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    rmSync(directory, { recursive: true, force: true });
  }
});
