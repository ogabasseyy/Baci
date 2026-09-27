import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { hasTargetStatusWhitelist } = serializedInventoryReleaseLocks;

test('release scope stays fixed after merchant authorization', () => {
  const release = latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.equal(hasTargetStatusWhitelist(release), true);

  const reassigned = release.replace(
    /(RAISE\s+EXCEPTION\s+'forbidden'[^;]*;\s*END\s+IF\s*;)/i,
    `$1\n\n  p_merchant_id := (SELECT merchant_id FROM public.orders WHERE id = p_order_id);`
  );
  assert.notEqual(reassigned, release);
  assert.equal(hasTargetStatusWhitelist(reassigned), false);
});
