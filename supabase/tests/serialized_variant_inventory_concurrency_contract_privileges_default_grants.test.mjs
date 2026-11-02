import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivileges } from './serialized_variant_inventory_concurrency_contract_privileges.mjs';

// Migration 20261030233000 revokes EXECUTE from PUBLIC for functions that
// postgres creates, so recreating a private function no longer re-opens it.
const signature =
  'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)';
const authSources = (...append) => [
  ...serializedInventoryContract.migrationSources,
  ...append,
];
const recreated = `
    DROP FUNCTION ${signature};
    CREATE FUNCTION private.claim_variant_inventory_units_for_order_item_internal(
      p_merchant_id uuid,
      p_order_id uuid,
      p_order_item_id uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
  `;

test('freshly recreated private functions do not regain PUBLIC under the hardened default privileges', () => {
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(
      authSources(recreated),
      signature
    ),
    false
  );
});

test('recreated private functions regain access when PUBLIC is granted again', () => {
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(
      authSources(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
        recreated
      ),
      signature
    ),
    true
  );
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(
      authSources(
        recreated,
        `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`
      ),
      signature
    ),
    true
  );
});
