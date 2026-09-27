import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

function recreationSource(defaultPrivilege) {
  return [
    'CREATE FUNCTION private.fixture(uuid) RETURNS void SECURITY DEFINER',
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'REVOKE ALL ON FUNCTION private.fixture(uuid) FROM PUBLIC;',
    defaultPrivilege,
    'DROP FUNCTION private.fixture(uuid);',
    'CREATE FUNCTION private.fixture(uuid) RETURNS void SECURITY DEFINER',
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'REVOKE ALL ON FUNCTION private.fixture(uuid) FROM PUBLIC;',
  ].join('\n');
}

test('applies default function privileges across a comma-separated schema list', () => {
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      recreationSource(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, private GRANT EXECUTE ON FUNCTIONS TO authenticated;'
      ),
      'private.fixture(uuid)'
    ),
    true
  );
});

test('does not apply default function privileges for another owner', () => {
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      recreationSource(
        'ALTER DEFAULT PRIVILEGES FOR ROLE unrelated_owner IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO authenticated;'
      ),
      'private.fixture(uuid)'
    ),
    false
  );
});

test('tracks quoted function recreation after a drop', () => {
  const source = [
    'CREATE FUNCTION private.fixture(uuid) RETURNS void SECURITY DEFINER',
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'REVOKE ALL ON FUNCTION private.fixture(uuid) FROM PUBLIC;',
    'DROP FUNCTION private.fixture(uuid);',
    'CREATE FUNCTION "private"."fixture"(uuid) RETURNS void SECURITY DEFINER',
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
  ].join('\n');

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      'private.fixture(uuid)'
    ),
    true
  );
});

test('tracks the active role as owner during function recreation', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `DROP FUNCTION ${signature};`,
    'GRANT USAGE, CREATE ON SCHEMA private TO authenticated;',
    'SET ROLE authenticated;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'RESET ROLE;',
  ].join('\n');

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('preserves global default grants across schema-scoped revokes', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM authenticated;',
    `DROP FUNCTION ${signature};`,
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
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

test('applies multi-owner default privileges on recreation', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres, inventory_owner IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO authenticated;',
    `DROP FUNCTION ${signature};`,
    'SET ROLE inventory_owner;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'RESET ROLE;',
  ].join('\n');

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('tracks scoped role changes as owner during function recreation', () => {
  const signature = 'private.fixture(uuid)';
  for (const setRole of [
    'SET LOCAL ROLE authenticated;',
    'SET SESSION ROLE authenticated;',
  ]) {
    const source = [
      `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
      'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
      `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
      `DROP FUNCTION ${signature};`,
      'GRANT USAGE, CREATE ON SCHEMA private TO authenticated;',
      setRole,
      `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
      'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
      `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
      'RESET ROLE;',
    ].join('\n');

    assert.equal(
      serializedInventoryPrivilegeExecution.authenticatedCanExecute(
        source,
        signature
      ),
      true
    );
  }
});

test('binds ownerless default privileges to the active role', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE inventory_owner;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO authenticated;',
    `DROP FUNCTION ${signature};`,
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'RESET ROLE;',
  ].join('\n');

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('tracks session authorization as owner during function recreation', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `DROP FUNCTION ${signature};`,
    'GRANT USAGE, CREATE ON SCHEMA private TO authenticated;',
    'SET SESSION AUTHORIZATION authenticated;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER`,
    'LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    'RESET SESSION AUTHORIZATION;',
  ].join('\n');

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});
