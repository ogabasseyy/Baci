import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';

test('matches scoped availability predicates with aliases and parentheses', () => {
  const query = `
    SELECT unit.id
    FROM public.variant_inventory AS unit
    WHERE (unit.status = 'available')
      AND (unit.sold_at IS NULL)
      AND unit.variant_id = v_variant_id
      AND (unit.merchant_id = p_merchant_id)
      AND (unit.order_item_id IS NULL)
      AND unit.order_id IS NULL
    ORDER BY unit.id
    LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;

  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      query,
      'v_variant_id'
    ),
    true
  );
});
