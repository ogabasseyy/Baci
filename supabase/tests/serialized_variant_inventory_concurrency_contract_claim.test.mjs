import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const { latestFunctionBody } = serializedInventoryContract;

test('serialized claims keep counts item-scoped and reserve each selected unit', () => {
  const claim = latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  const reservedCountQueries =
    claim.match(
      /SELECT\s+count\(\*\)::integer\s+INTO\s+v_reserved_count\b[^;]*;/gi
    ) ?? [];
  assert.ok(
    reservedCountQueries.length > 0,
    'claim must populate reserved counts'
  );
  assert.ok(
    reservedCountQueries.every((query) =>
      /\bWHERE\b[^;]*\border_item_id\s*=\s*p_order_item_id\b/i.test(query)
    ),
    'reserved counts must stay scoped to the target order item'
  );

  const reserveUnitUpdate =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\b(?=[^;]*\bSET\b)(?=[^;]*\bstatus\s*=\s*'reserved')(?=[^;]*\border_id\s*=\s*p_order_id)(?=[^;]*\border_item_id\s*=\s*p_order_item_id)(?=[^;]*\bWHERE\b[^;]*\bid\s*=\s*v_unit\.id\b)[^;]*;/i;
  assert.match(
    claim,
    reserveUnitUpdate,
    'each claimed unit must be transitioned to reserved for the target order item'
  );
  assert.doesNotMatch(
    "UPDATE public.variant_inventory SET status = 'available', order_id = p_order_id, order_item_id = p_order_item_id WHERE id = v_unit.id;",
    reserveUnitUpdate
  );
});
