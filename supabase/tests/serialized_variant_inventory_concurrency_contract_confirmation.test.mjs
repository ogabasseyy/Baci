import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';

const {
  confirmationLocksPrecedeReclaim,
  findConfirmationLocks,
  findReclaimReservationTransition,
} = serializedInventoryConfirmation;

test('confirmation locks require mandatory tenant and order scopes', () => {
  const valid = `
    SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE;
    SELECT oi.id FROM order_items oi WHERE oi.order_id = p_order_id FOR UPDATE;
  `;
  assert.ok(findConfirmationLocks(valid).order);
  assert.ok(findConfirmationLocks(valid).item);
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'oi.order_id = p_order_id',
        'oi.order_id = p_order_id OR true'
      )
    ).item,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid
        .replace(
          'FROM orders o WHERE',
          'FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE'
        )
        .replace('FOR UPDATE;', 'FOR UPDATE OF m;')
    ).order,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace('o.id = p_order_id', 'o.id = p_order_id OR true')
    ).order,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'FOR UPDATE;',
        'AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = o.merchant_id FOR UPDATE);'
      )
    ).order,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'WHERE oi.order_id = p_order_id FOR UPDATE',
        'WHERE oi.order_id = p_order_id LIMIT 1 FOR UPDATE'
      )
    ).item,
    undefined
  );
});

test('confirmation locks before reclaiming and reserves each counted unit', () => {
  const confirm = serializedInventoryContract.latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const locks = findConfirmationLocks(confirm);
  const selector =
    serializedInventoryContract.availableUnitWhereClause(confirm);
  const transition = findReclaimReservationTransition(confirm);

  assert.ok(locks.order);
  assert.ok(locks.item);
  assert.ok(selector);
  assert.ok(transition);
  assert.equal(confirmationLocksPrecedeReclaim(confirm), true);

  const withoutTransition = confirm.replace(
    /UPDATE public\.variant_inventory\s+SET status = 'reserved',[\s\S]*?WHERE id = v_unit\.id;/i,
    'PERFORM v_unit.id;'
  );
  assert.equal(findReclaimReservationTransition(withoutTransition), undefined);
  const conditionalTransition = confirm.replace(
    /UPDATE public\.variant_inventory\s+SET status = 'reserved',[\s\S]*?WHERE id = v_unit\.id;/i,
    (update) => `IF false THEN\n${update}\nEND IF;`
  );
  assert.equal(
    findReclaimReservationTransition(conditionalTransition),
    undefined
  );
  const caseGuardedTransition = confirm.replace(
    /UPDATE public\.variant_inventory\s+SET status = 'reserved',[\s\S]*?WHERE id = v_unit\.id;/i,
    (update) => `CASE WHEN false THEN\n${update}\nEND CASE;`
  );
  assert.equal(
    findReclaimReservationTransition(caseGuardedTransition),
    undefined
  );

  const outOfOrder = `
    SELECT vi.id FROM variant_inventory vi
    WHERE vi.merchant_id = p_merchant_id
      AND vi.variant_id = v_actual_variant_id AND vi.status = 'available'
      AND vi.order_id IS NULL AND vi.order_item_id IS NULL
      AND vi.sold_at IS NULL
    ORDER BY vi.id LIMIT v_needed FOR UPDATE SKIP LOCKED;
    SELECT 1 FROM orders o
    WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE;
    SELECT oi.id FROM order_items oi
    WHERE oi.order_id = p_order_id FOR UPDATE;
  `;
  assert.equal(confirmationLocksPrecedeReclaim(outOfOrder), false);
  assert.equal(
    confirmationLocksPrecedeReclaim(
      `IF false THEN\n${outOfOrder.slice(outOfOrder.indexOf('SELECT 1 FROM orders'))}\nEND IF;\n${outOfOrder.slice(0, outOfOrder.indexOf('SELECT 1 FROM orders'))}`
    ),
    false
  );
  assert.equal(
    findReclaimReservationTransition(
      confirm.replace(
        'WHERE id = v_unit.id;',
        "WHERE id = v_unit.id AND status = 'reserved';"
      )
    ),
    undefined
  );
});
