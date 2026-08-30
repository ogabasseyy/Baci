import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';
import './serialized_variant_inventory_concurrency_contract_privilege_execution_recreation.test.mjs';

test('inherits function execution through a granted intermediate role', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;
    GRANT inventory_delegate TO authenticated;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('inherits execution through membership grants with options', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;
    GRANT inventory_delegate TO authenticated WITH ADMIN OPTION;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('recognizes grant options when computing authenticated execution', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate WITH GRANT OPTION;
    GRANT inventory_delegate TO authenticated;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('recognizes direct grants with GROUP and grant-option syntax', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${signature}
      TO GROUP authenticated WITH GRANT OPTION;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('recognizes direct grants with an omitted function argument list', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION private.fixture TO authenticated;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('recognizes quoted function privilege targets', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION "private"."fixture"(uuid) TO authenticated;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('treats authenticated ownership as execution authority', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    ALTER FUNCTION ${signature} OWNER TO authenticated;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('applies all-functions grants across a comma-separated schema list', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, private TO authenticated;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('recognizes schema-wide grants with grant-option syntax', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated WITH GRANT OPTION;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('fails closed when privilege DDL is executed dynamically', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    DO $wrapper$
    BEGIN
      EXECUTE 'GRANT EXECUTE ON FUNCTION private.' ||
        'fixture(uuid) TO authenticated';
    END;
    $wrapper$;
  `;
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('invalidates authenticated execution after a DROP ROUTINE', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;
    DROP ROUTINE ${signature};
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    false
  );
});

test('invalidates authenticated execution when protected function is later in a DROP list', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;
    DROP FUNCTION private.other(uuid), ${signature} CASCADE;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    false
  );
});

test('applies default function privileges when a private function is recreated', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA private
      GRANT EXECUTE ON FUNCTIONS TO authenticated;
    DROP FUNCTION ${signature};
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
  `;

  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});
