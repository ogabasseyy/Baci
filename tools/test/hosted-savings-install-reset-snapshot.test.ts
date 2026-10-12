import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsResetSnapshotSql } from './hosted-savings-install-reset-snapshot';

test('serializes sequence state without requiring a sequence composite rowtype', () => {
  const branch = /IF item\.relkind='S' THEN([\s\S]*?)ELSE/.exec(
    hostedSavingsResetSnapshotSql
  )?.[1];
  assert.ok(branch, 'sequence serialization needs an explicit branch');
  assert.match(branch, /jsonb_build_array\(last_value,log_cnt,is_called\)/);
  assert.match(branch, /encode\(sha256\(convert_to\(/);
  assert.match(branch, /FROM %I\.%I/);
  assert.doesNotMatch(branch, /to_jsonb\(row\)|nextval|setval|currval/);
});

test('retains sequence definitions, all relation coverage, and the shared before-after data fingerprint', () => {
  assert.match(
    hostedSavingsResetSnapshotSql,
    /\('pg_sequence','pg_temp\.recovery_protected_object/
  );
  assert.match(
    hostedSavingsResetSnapshotSql,
    /relkind IN \('r','p','m','S','f'\)/
  );
  assert.match(
    hostedSavingsResetSnapshotSql,
    /ELSE\s+EXECUTE format\('[\s\S]*?FROM ONLY %I\.%I row/
  );
  assert.match(
    hostedSavingsResetSnapshotSql,
    /jsonb_build_object\('data:'\|\|item\.oid::text,digest\)/
  );
  assert.match(
    hostedSavingsResetSnapshotSql,
    /Foreign data cannot be snapshotted safely/
  );
});
