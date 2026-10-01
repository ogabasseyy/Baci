import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

const { authenticatedCanExecute } = serializedInventoryPrivilegeExecution;

function privateFunction(signature) {
  return [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
}

test('applies schema-wide revokes from the matching grantor', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    privateFunction(signature),
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;',
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM authenticated GRANTED BY postgres;',
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), false);
});

test('preserves schema-wide grants against other-grantor revokes', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    privateFunction(signature),
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;',
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM authenticated GRANTED BY mallory;',
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), true);
});

test('revokes direct grants held by a dropped-owned role', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    privateFunction(signature),
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    'DROP OWNED BY authenticated;',
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), false);
});

test('revokes inherited memberships held by a dropped-owned role', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    privateFunction(signature),
    `GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;`,
    'GRANT inventory_delegate TO authenticated;',
    'DROP OWNED BY authenticated;',
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), false);
});

test('preserves role memberships supplied by another grantor', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE grantor_one;',
    'GRANT inventory_delegate TO authenticated;',
    'SET ROLE grantor_two;',
    'GRANT inventory_delegate TO authenticated;',
    'REVOKE inventory_delegate FROM authenticated GRANTED BY grantor_one;',
    privateFunction(signature),
    `GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;`,
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), true);
});

test('drops role memberships revoked by their only grantor', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE grantor_one;',
    'GRANT inventory_delegate TO authenticated;',
    'REVOKE inventory_delegate FROM authenticated;',
    privateFunction(signature),
    `GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;`,
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), false);
});

test('applies static grants executed inside DO blocks', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    privateFunction(signature),
    `DO $$ BEGIN GRANT EXECUTE ON FUNCTION ${signature} TO authenticated; END $$;`,
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), true);
});

test('ignores grant-free DO blocks', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    privateFunction(signature),
    'DO $body$ DECLARE v_count integer := 0; BEGIN v_count := v_count + 1; END $body$;',
  ].join('\n');
  assert.equal(authenticatedCanExecute(source, signature), false);
});
