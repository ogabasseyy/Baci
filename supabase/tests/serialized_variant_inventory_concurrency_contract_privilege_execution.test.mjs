import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

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
