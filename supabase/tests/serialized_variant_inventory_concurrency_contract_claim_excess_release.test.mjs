import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryClaim } from './serialized_variant_inventory_concurrency_contract_claim.mjs';

test('requires the reachable reserved surplus assignment before release', () => {
  const claim = serializedInventoryContract.latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  const assignment = /\bv_excess\s*:=\s*v_reserved_count\s*-\s*v_qty\s*;/i.exec(
    claim
  );
  assert.ok(assignment);
  assert.ok(serializedInventoryClaim.findEffectiveExcessRelease(claim));
  assert.equal(
    serializedInventoryClaim.findEffectiveExcessRelease(
      claim.replace(assignment[0], 'v_excess := 0;')
    ),
    undefined
  );
});
