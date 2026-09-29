import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

test('resolves special roles in ownership transfers', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE authenticated;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `ALTER FUNCTION ${signature} OWNER TO CURRENT_USER;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('resolves special roles in privilege grantees', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'SET ROLE authenticated;',
    `GRANT EXECUTE ON FUNCTION ${signature} TO CURRENT_USER;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('resolves special roles in membership grants', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'SET ROLE authenticated;',
    'GRANT inventory_delegate TO CURRENT_USER;',
    `GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('resolves special roles for default-privilege owners', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `DROP FUNCTION ${signature};`,
    'ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO authenticated;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('resolves special roles for default-privilege grantees', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `DROP FUNCTION ${signature};`,
    'SET ROLE authenticated;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO CURRENT_USER;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `ALTER FUNCTION ${signature} OWNER TO deployer;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('resolves special roles for reassign destinations', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'SET ROLE authenticated;',
    'REASSIGN OWNED BY deployer TO CURRENT_USER;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('applies matching-grantor revokes of schema-wide grants', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;',
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM authenticated GRANTED BY postgres;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    false
  );
});
