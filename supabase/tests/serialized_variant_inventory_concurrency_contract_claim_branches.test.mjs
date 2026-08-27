import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryClaim } from './serialized_variant_inventory_concurrency_contract_claim.mjs';

test('strict shortage exceptions stay in the shortage IF arm', () => {
  const claim = serializedInventoryContract.latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  const target =
    /^\s*IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s+(?:\(\s*)?v_reserved_count\s*\+\s*v_claimed_count\s*(?:\s*\))?\s*<\s*v_qty\s+THEN\b/im;
  assert.equal(
    serializedInventoryClaim.strictShortagePrecedesSuccess(claim),
    true
  );
  const strictBlock =
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s*\(?\s*v_reserved_count\s*\+\s*v_claimed_count\s*\)?\s*<\s*v_qty\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      claim
    );
  assert.ok(strictBlock);
  const then = /\bTHEN\b/i.exec(strictBlock[0]);
  const end = /\bEND\s+IF\s*;\s*$/i.exec(strictBlock[0]);
  assert.ok(then);
  assert.ok(end);
  const inverted = claim.replace(
    strictBlock[0],
    (block) =>
      `${block.slice(0, then.index + then[0].length)}\nNULL;\nELSE\n${block.slice(then.index + then[0].length, end.index)}${end[0]}`
  );
  const invertedBranches = serializedInventoryBranches.extractIfArms(
    inverted,
    target
  );
  assert.doesNotMatch(invertedBranches.thenBranch, /RAISE\s+EXCEPTION/i);
  assert.equal(
    serializedInventoryClaim.strictShortagePrecedesSuccess(inverted),
    false
  );
});
