import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('both local runners execute the same private schema and replay assertions', async () => {
  const [socket, supabase, shared] = await Promise.all([
    read('./piggyvest-full-local-checks.sql'),
    read('./piggyvest-full-schema-check.sql'),
    read('./piggyvest-private-schema-check.sql'),
  ]);
  for (const wrapper of [socket, supabase]) {
    assert.match(wrapper, /^BEGIN;/);
    assert.match(wrapper, /\\ir piggyvest-private-schema-check\.sql/);
    assert.match(wrapper, /ROLLBACK;\s*$/);
  }
  assert.match(socket, /current_setting\('listen_addresses'\) <> ''/);
  assert.match(shared, /ungranted probe RPC succeeded/);
  assert.match(shared, /synthetic replay failed/);
  assert.match(shared, /RLS leaked fixture row/);
  assert.doesNotMatch(shared, /^(BEGIN|ROLLBACK);/m);
});

test('the full schema check requires the real public schema and an unprivileged probe', async () => {
  const source = await read('./piggyvest-full-schema-check.sql');
  assert.match(
    source,
    /CREATE ROLE piggyvest_full_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEROLE NOCREATEDB/
  );
  assert.match(source, /public\.customer_savings_goals/);
  assert.match(source, /public\.products/);
  assert.match(source, /public\.orders/);
  assert.match(source, /pg_class/);
  assert.match(source, /relrowsecurity/);
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|CREATE SCHEMA/);
});

test('permits the creating replay role to SET the probe without granting authority to the probe', async () => {
  const source = await read('./piggyvest-full-schema-check.sql');
  const grant =
    "'GRANT piggyvest_full_probe TO %I WITH INHERIT FALSE, SET TRUE', current_user";
  assert.ok(source.includes(grant));
  assert.ok(
    source.indexOf(grant) > source.indexOf('CREATE ROLE piggyvest_full_probe')
  );
  assert.ok(
    source.indexOf(grant) <
      source.indexOf('\\ir piggyvest-private-schema-check.sql')
  );
  assert.match(source, /^BEGIN;/);
  assert.match(source, /ROLLBACK;\s*$/);
  assert.doesNotMatch(source, /GRANT\s+\w+\s+TO\s+piggyvest_full_probe/i);
  assert.doesNotMatch(source, /GRANT piggyvest_full_probe TO CURRENT_USER/);
  assert.match(source, /EXECUTE format\(/);
  const shared = await read('./piggyvest-private-schema-check.sql');
  assert.match(shared, /member='piggyvest_full_probe'::regrole/);
  assert.equal(
    (shared.match(/SET LOCAL ROLE piggyvest_full_probe;/g) ?? []).length,
    4
  );
});
