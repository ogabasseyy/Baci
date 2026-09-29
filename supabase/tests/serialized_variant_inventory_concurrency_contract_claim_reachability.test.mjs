import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryClaim } from './serialized_variant_inventory_concurrency_contract_claim.mjs';

test('strict shortage rejects an early success return before its exception', () => {
  const claim = serializedInventoryContract.latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  assert.equal(
    serializedInventoryClaim.strictShortagePrecedesSuccess(
      claim.replace(
        /RAISE\s+EXCEPTION\s+'serialized_inventory_unavailable'[^;]*;/i,
        (raise) => `RETURN v_fulfillment_data;\n${raise}`
      )
    ),
    false
  );
});
