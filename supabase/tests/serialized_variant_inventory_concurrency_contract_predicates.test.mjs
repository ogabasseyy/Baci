import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPredicates } from './serialized_variant_inventory_concurrency_contract_predicates.mjs';

const requiredMerchant = /merchant_id\s*=\s*p_merchant_id/i;

test('matches required predicates beside unrelated negative conjuncts', () => {
  assert.equal(
    serializedInventoryPredicates.isRequiredConjunct(
      'NOT vi.quarantined AND vi.merchant_id = p_merchant_id',
      requiredMerchant
    ),
    true
  );
  assert.equal(
    serializedInventoryPredicates.isRequiredConjunct(
      'vi.merchant_id = p_merchant_id AND vi.archived IS FALSE',
      requiredMerchant
    ),
    true
  );
});

test('rejects a matching predicate when that atom is negated or optional', () => {
  assert.equal(
    serializedInventoryPredicates.isRequiredConjunct(
      'NOT (vi.merchant_id = p_merchant_id)',
      requiredMerchant
    ),
    false
  );
  assert.equal(
    serializedInventoryPredicates.isRequiredConjunct(
      'vi.merchant_id = p_merchant_id OR vi.merchant_id IS NULL',
      requiredMerchant
    ),
    false
  );
});
