import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsResetDropSql as sql } from './hosted-savings-install-reset-drop';

test('guards every enumerated drop by full object address and rejects unknown objects', () => {
  assert.match(sql, /FOR dropped IN SELECT \* FROM pg_event_trigger_dropped_objects\(\) LOOP/);
  assert.match(sql, /owned.classid=dropped.classid AND owned.objid=dropped.objid AND owned.objsubid=dropped.objsubid/);
  assert.match(sql, /dropped.schema_name IS NULL AND dropped.classid NOT IN/);
  for (const code of ['P7202', 'P7203', 'P7204', 'P7205']) assert.ok(sql.includes(`ERRCODE='${code}'`));
});

test('enables the guard before destructive commands and verifies firing before removal', () => {
  const phases = ['ENABLE ALWAYS;', "EXECUTE 'DROP FUNCTION '", 'DROP TABLE public.orders CASCADE;', 'DROP TYPE public.negotiation_status', 'DROP SCHEMA hosted_savings_install_private,supabase_migrations CASCADE;', 'DO $fired$', 'DISABLE;', 'DROP EVENT TRIGGER hosted_savings_reset_drop_guard;'];
  let previous = -1;
  for (const phase of phases) {
    const position = sql.indexOf(phase);
    assert.ok(position > previous, `Missing or unordered phase: ${phase}`);
    previous = position;
  }
  assert.doesNotMatch(sql, /DROP SCHEMA public|DROP ROLE|DROP EXTENSION|COMMIT;/);
});
