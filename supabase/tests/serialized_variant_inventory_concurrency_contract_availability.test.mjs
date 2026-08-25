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

test('rejects availability predicates with prefixed scope variables', () => {
  const query = `
    SELECT unit.id
    FROM variant_inventory unit
    WHERE unit.merchant_id = p_merchant_id_backup
      AND unit.variant_id = v_variant_id_old
      AND unit.status = 'available'
      AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL
      AND unit.sold_at IS NULL
    ORDER BY unit.id
    LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;

  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      query,
      'v_variant_id'
    ),
    false
  );
});

test('rejects required predicates embedded in dollar-quoted literals', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE $$unit.merchant_id = p_merchant_id$$ IS NOT NULL
      AND $$unit.variant_id = v_variant_id$$ IS NOT NULL
      AND $$unit.status = 'available'$$ IS NOT NULL
      AND $$unit.order_id IS NULL$$ IS NOT NULL
      AND $$unit.order_item_id IS NULL$$ IS NOT NULL
      AND $$unit.sold_at IS NULL$$ IS NOT NULL
    ORDER BY unit.created_at LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source,
      'v_variant_id'
    ),
    false
  );
});

test('requires the available lifecycle status', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE unit.merchant_id = p_merchant_id AND unit.variant_id = v_variant_id
      AND unit.status = 'reserved' AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL AND unit.sold_at IS NULL
    ORDER BY unit.created_at LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source,
      'v_variant_id'
    ),
    false
  );
});

test('requires branch eligibility when the selector is order-scoped', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE unit.merchant_id = p_merchant_id AND unit.variant_id = v_variant_id
      AND unit.status = 'available' AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL AND unit.sold_at IS NULL
      AND ((v_order_branch_id IS NULL AND unit.branch_id IS NULL)
        OR (v_order_branch_id IS NOT NULL AND
          (unit.branch_id = v_order_branch_id OR unit.branch_id IS NULL)))
    ORDER BY unit.id LIMIT v_needed FOR UPDATE SKIP LOCKED;
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
        /\s+AND\s+\(\(v_order_branch_id[\s\S]*?\)\)\s*\n\s*ORDER/i,
        '\nORDER'
      ),
      'v_variant_id',
      'v_order_branch_id'
    ),
    false
  );
});

test('rejects availability clauses supplied only by a nested query', () => {
  const source = `
    SELECT unit.id FROM variant_inventory unit
    WHERE EXISTS (
      SELECT 1 FROM variant_inventory nested
      WHERE nested.merchant_id = p_merchant_id
        AND nested.variant_id = v_variant_id
        AND nested.status = 'available'
        AND nested.order_id IS NULL AND nested.order_item_id IS NULL
        AND nested.sold_at IS NULL
      ORDER BY nested.id LIMIT v_needed FOR UPDATE SKIP LOCKED
    );
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      source,
      'v_variant_id'
    ),
    false
  );
});
