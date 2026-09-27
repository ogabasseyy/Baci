import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';

test('rejects constant-false availability predicates', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE unit.merchant_id = p_merchant_id AND unit.variant_id = v_variant_id
      AND unit.status = 'available' AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL AND unit.sold_at IS NULL
    ORDER BY unit.id LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source,
      'v_variant_id'
    ),
    true
  );
  for (const contradiction of ['1 = 0', '(0 = 1)', 'FALSE', "'a' = 'b'"]) {
    assert.equal(
      serializedInventoryAvailability.availableUnitPredicatesMatch(
        source.replace(
          'AND unit.sold_at IS NULL',
          `AND ${contradiction} AND unit.sold_at IS NULL`
        ),
        'v_variant_id'
      ),
      false
    );
  }
});

test('rejects branch-narrowed available-unit selectors', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE unit.merchant_id = p_merchant_id AND unit.variant_id = v_variant_id
      AND unit.status = 'available' AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL AND unit.sold_at IS NULL
      AND ((v_order_branch_id IS NULL AND unit.branch_id IS NULL)
        OR (v_order_branch_id IS NOT NULL AND
          (unit.branch_id = v_order_branch_id OR unit.branch_id IS NULL)))
    ORDER BY CASE WHEN unit.branch_id = v_order_branch_id THEN 0 ELSE 1 END ASC, unit.id
    LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source,
      'v_variant_id',
      'v_order_branch_id'
    ),
    true
  );
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source.replace(
        ')))\n    ORDER BY',
        '))) AND unit.branch_id = v_order_branch_id\n    ORDER BY'
      ),
      'v_variant_id',
      'v_order_branch_id'
    ),
    false
  );
});
