import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from 'pg';

const repository = resolve(import.meta.dirname, '../..');
const bin =
  process.argv
    .find((arg) => arg.startsWith('--postgres-bin='))
    ?.slice('--postgres-bin='.length) ?? '/opt/homebrew/opt/postgresql@17/bin';

test('POD persistence policy and concurrent flag revocation', async () => {
  const directory = mkdtempSync('/tmp/baci-pod-policy-');
  const socket = join(directory, 'socket');
  const data = join(directory, 'data');
  mkdirSync(socket, { mode: 0o700 });
  const environment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
  function run(command, args) {
    const result = spawnSync(join(bin, command), args, {
      env: environment,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const configuration = {
    host: socket,
    port: 55483,
    user: 'postgres',
    database: 'postgres',
  };
  const admin = new Client(configuration);
  const admission = new Client(configuration);
  const revocation = new Client(configuration);
  let started = false;
  let connected = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(directory, 'postgres.log'),
      '-o',
      `-h '' -k '${socket}' -p 55483`,
      'start',
    ]);
    started = true;
    await Promise.all([
      admin.connect(),
      admission.connect(),
      revocation.connect(),
    ]);
    connected = true;
    await admin.query(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA private;
      CREATE TABLE public.merchants(id uuid PRIMARY KEY,email text,business_name text,slug text,is_published boolean);
      CREATE TABLE public.merchant_feature_settings(merchant_id uuid PRIMARY KEY,pay_on_delivery_enabled boolean);
      CREATE FUNCTION public.fixture_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN
          RAISE EXCEPTION 'audit_actor_required' USING ERRCODE='28000';
        END IF;
        RETURN coalesce(NEW,OLD);
      END $$;
      CREATE TRIGGER fixture_settings_audit BEFORE INSERT OR UPDATE OR DELETE ON public.merchant_feature_settings
        FOR EACH ROW EXECUTE FUNCTION public.fixture_settings_audit();
      CREATE FUNCTION public.fixture_default_settings() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.merchant_feature_settings VALUES(NEW.id,false); RETURN NEW; END $$;
      CREATE TRIGGER fixture_default_settings AFTER INSERT ON public.merchants
        FOR EACH ROW EXECUTE FUNCTION public.fixture_default_settings();
      CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,
        order_number text,total numeric,payment_method text,customer_email text);
    `);
    if (!process.argv.includes('--baseline')) {
      await admin.query(
        readFileSync(
          join(
            repository,
            'supabase/migrations/20261101071733_enforce_merchant_pay_on_delivery_policy.sql'
          ),
          'utf8'
        )
      );
    }
    await admin.query(
      readFileSync(
        join(repository, 'supabase/tests/order_pay_on_delivery_policy.sql'),
        'utf8'
      )
    );
    const merchant = '36700000-0000-4000-8000-000000000004';
    await admin.query(
      "SELECT set_config('request.jwt.claim.role','service_role',false)"
    );
    await revocation.query(
      "SELECT set_config('request.jwt.claim.role','service_role',false)"
    );
    await admin.query('INSERT INTO public.merchants(id) VALUES($1);', [
      merchant,
    ]);
    await admin.query(
      'UPDATE public.merchant_feature_settings SET pay_on_delivery_enabled=true WHERE merchant_id=$1',
      [merchant]
    );
    await admission.query('BEGIN');
    await admission.query(
      "INSERT INTO public.orders(merchant_id,order_number,total,payment_method) VALUES($1,'concurrent-pod',1,'pod')",
      [merchant]
    );
    const {
      rows: [{ pid }],
    } = await revocation.query('SELECT pg_backend_pid() AS pid');
    const disable = revocation.query(
      'UPDATE public.merchant_feature_settings SET pay_on_delivery_enabled=false WHERE merchant_id=$1',
      [merchant]
    );
    // Observe the real database lock, not a guessed delay or completion time.
    let blocked = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await admin.query(
        "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
        [pid]
      );
      if (rows[0]?.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      blocked,
      true,
      'flag revocation must wait for accepted order commit'
    );
    await admission.query('COMMIT');
    await disable;
    await assert.rejects(
      admin.query(
        "INSERT INTO public.orders(merchant_id,order_number,total,payment_method) VALUES($1,'after-revocation',1,'pay_on_delivery')",
        [merchant]
      ),
      { message: 'pay_on_delivery_disabled' }
    );
    const { rows } = await admin.query(
      'SELECT count(*)::integer AS count FROM public.orders'
    );
    assert.equal(rows[0].count, 1);
  } finally {
    if (connected) await admission.query('ROLLBACK');
    await Promise.all([admin.end(), admission.end(), revocation.end()]);
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    rmSync(directory, { recursive: true });
  }
});
