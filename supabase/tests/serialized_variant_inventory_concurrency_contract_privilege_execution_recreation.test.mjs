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
