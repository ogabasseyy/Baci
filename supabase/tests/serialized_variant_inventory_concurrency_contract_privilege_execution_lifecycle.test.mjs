import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

test('resolves special roles in ownership transfers', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'REASSIGN OWNED BY CURRENT_USER TO authenticated;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('sees schema-wide grants carrying a grantor clause', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated GRANTED BY postgres;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('sees grants after literals ending in a backslash', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `SELECT 'ends with backslash\\';`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    `SELECT 'another literal';`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('tracks routines renamed into the protected identity', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `ALTER FUNCTION ${signature} RENAME TO fixture_retired;`,
    'CREATE FUNCTION private.standby(uuid) RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'GRANT EXECUTE ON FUNCTION private.standby(uuid) TO authenticated;',
    'ALTER FUNCTION private.standby(uuid) RENAME TO fixture;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );

  const mismatched = source.replace(
    'ALTER FUNCTION private.standby(uuid) RENAME TO fixture;',
    'ALTER FUNCTION private.standby(text) RENAME TO fixture;'
  );
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      mismatched,
      signature
    ),
    false
  );
});

test('ignores lifecycle decoys inside dollar-quoted literals', () => {
  const signature = 'private.confirm_order_inventory_reservations(uuid, uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    'CREATE FUNCTION private.helper() RETURNS text LANGUAGE plpgsql AS $func$ BEGIN',
    `  RETURN $ddl$DROP FUNCTION ${signature};$ddl$;`,
    'END; $func$;',
    `SELECT $ddl$DROP FUNCTION ${signature};$ddl$;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('tracks routines moved into the protected schema', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `ALTER FUNCTION ${signature} SET SCHEMA public;`,
    'CREATE FUNCTION staging.fixture(uuid) RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'GRANT EXECUTE ON FUNCTION staging.fixture(uuid) TO authenticated;',
    'ALTER FUNCTION staging.fixture(uuid) SET SCHEMA private;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('inherits execution through quoted roles containing commas', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature} TO "inventory,delegate";
    GRANT "inventory,delegate" TO authenticated;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});
