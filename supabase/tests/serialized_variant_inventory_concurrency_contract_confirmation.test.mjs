import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  confirmationLocksPrecedeReclaim,
  findConfirmationLocks,
  findReclaimReservationTransition,
} = serializedInventoryConfirmation;

function privateConfirmationIsRestricted(source) {
  const statements = [
    ...source.matchAll(
      /(?:REVOKE\s+ALL|GRANT\s+EXECUTE)\s+ON\s+FUNCTION\s+private\.confirm_order_inventory_reservations\s*\(\s*uuid\s*,\s*uuid\s*\)[^;]*;/gi
    ),
  ].filter((match) => /\bauthenticated\b/i.test(match[0]));
  return /^REVOKE\s+ALL\b/i.test(statements.at(-1)?.[0] ?? '');
}

function privateClaimIsRestricted(source) {
  const statements = [
    ...source.matchAll(
      /(?:REVOKE\s+ALL|GRANT\s+EXECUTE)\s+ON\s+FUNCTION\s+private\.claim_variant_inventory_units_for_order_item_internal\s*\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*\)[^;]*;/gi
    ),
  ].filter((match) => /\bauthenticated\b/i.test(match[0]));
  return /^REVOKE\s+ALL\b/i.test(statements.at(-1)?.[0] ?? '');
}

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
  const publicConfirm = serializedInventoryContract.latestFunctionBody(
    'public.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const executablePublicConfirm = serializedInventorySqlParser.maskSqlLiterals(
    publicConfirm,
    { preserveStrings: true }
  );
  const authorization =
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+['"]forbidden['"][\s\S]*?END\s+IF\s*;/i.exec(
      executablePublicConfirm
    );
  const delegation =
    /RETURN\s+private\.confirm_order_inventory_reservations\s*\(/i.exec(
      executablePublicConfirm
    );
  assert.ok(authorization);
  assert.ok(delegation);
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      executablePublicConfirm,
      authorization.index,
      delegation.index
    ),
    true
  );
  const migrationSql = serializedInventoryContract
    .migrationFileNames()
    .map((file) =>
      fs.readFileSync(
        path.join(serializedInventoryContract.migrationsDir, file),
        'utf8'
      )
    )
    .join('\n');
  assert.equal(privateConfirmationIsRestricted(migrationSql), true);
  assert.equal(privateClaimIsRestricted(migrationSql), true);
  assert.equal(
    privateConfirmationIsRestricted(
      `${migrationSql}\nGRANT EXECUTE ON FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) TO authenticated;`
    ),
    false
  );
  assert.equal(
    privateClaimIsRestricted(
      `${migrationSql}\nGRANT EXECUTE ON FUNCTION private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid) TO authenticated;`
    ),
    false
  );

  assert.ok(locks.order);
  assert.ok(locks.item);
  assert.ok(selector);
  assert.ok(transition);
  assert.equal(confirmationLocksPrecedeReclaim(confirm), true);
  assert.equal(
    findReclaimReservationTransition(
      confirm.replace(
        'v_reclaimed_count := v_reclaimed_count + 1;',
        'v_reclaimed_count := v_reclaimed_count + 1;\nv_reclaimed_count := v_reclaimed_count + 1;'
      )
    ),
    undefined
  );
  assert.match(confirm, /v_claimed_in_loop\s*:=\s*0\s*;/i);
  assert.match(
    confirm,
    /v_claimed_in_loop\s*:=\s*v_claimed_in_loop\s*\+\s*1\s*;/i
  );
  assert.doesNotMatch(
    confirm.replace(
      /v_claimed_in_loop\s*:=\s*v_claimed_in_loop\s*\+\s*1\s*;/i,
      ''
    ),
    /v_claimed_in_loop\s*:=\s*v_claimed_in_loop\s*\+\s*1\s*;/i
  );
  const neededAssignment =
    /\bv_needed\s*:=\s*v_item\s*\.\s*quantity\s*-\s*v_reserved_count\s*;/i;
  assert.match(confirm, neededAssignment);
  assert.doesNotMatch(
    confirm.replace(
      'v_needed := v_item.quantity - v_reserved_count;',
      'v_needed := v_item.quantity - v_reserved_count + 1;'
    ),
    neededAssignment
  );
  const confirmedHoldGuard =
    /IF\s+NOT\s+v_is_confirmed_hold\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]order_not_confirmed_for_inventory_hold['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i;
  assert.match(confirm, confirmedHoldGuard);
  assert.doesNotMatch(
    confirm.replace(confirmedHoldGuard, ''),
    confirmedHoldGuard
  );
  const fullyReservedExpiryClear =
    /IF\s+v_reserved_count\s*=\s*v_item\.quantity\s+THEN[\s\S]*?UPDATE\s+public\.variant_inventory\s+SET\s+reservation_expires_at\s*=\s*NULL[\s\S]*?WHERE\s+order_item_id\s*=\s*v_item\.id\s+AND\s+reservation_expires_at\s+IS\s+NOT\s+NULL\s*;/i;
  const partialExpiryClear =
    /ELSE[\s\S]*?UPDATE\s+public\.variant_inventory\s+SET\s+reservation_expires_at\s*=\s*NULL[\s\S]*?WHERE\s+order_item_id\s*=\s*v_item\.id\s*;/i;
  assert.match(confirm, fullyReservedExpiryClear);
  assert.match(confirm, partialExpiryClear);
  const withoutExistingExpiryClears = confirm
    .replace(
      fullyReservedExpiryClear,
      'IF v_reserved_count = v_item.quantity THEN NULL;'
    )
    .replace(partialExpiryClear, 'ELSE NULL;');
  assert.doesNotMatch(withoutExistingExpiryClears, fullyReservedExpiryClear);
  assert.doesNotMatch(withoutExistingExpiryClears, partialExpiryClear);

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
    confirmationLocksPrecedeReclaim(
      `CASE WHEN false THEN\n${outOfOrder.slice(outOfOrder.indexOf('SELECT 1 FROM orders'))}\nEND CASE;\n${outOfOrder.slice(0, outOfOrder.indexOf('SELECT 1 FROM orders'))}`
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
