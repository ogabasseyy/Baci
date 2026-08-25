import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { isRequiredConjunct, maskSqlLiterals } = serializedInventorySqlParser;

function hasOnlyUnitIdPredicate(whereClause) {
  return (
    whereClause
      .replace(/(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*v_unit\.id\b/i, '')
      .replace(/[\s();]/g, '') === ''
  );
}

function findEffectiveReserveUpdate(source) {
  const reserveUnitUpdate =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([^;]*?)\s+WHERE\s+([^;]*);/gi;
  const masked = maskSqlLiterals(source, { preserveStrings: true });
  const counters = [
    ...masked.matchAll(/v_claimed_count\s*:=\s*v_claimed_count\s*\+\s*1/gi),
  ];
  if (counters.length !== 1) return undefined;
  const [counter] = counters;
  return [...masked.matchAll(reserveUnitUpdate)].find(
    (match) =>
      /\bstatus\s*=\s*'reserved'/i.test(match[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(match[1]) &&
      /\border_item_id\s*=\s*p_order_item_id\b/i.test(match[1]) &&
      serializedInventoryControlFlow.dominatesControlFlow(
        masked,
        match.index,
        counter.index
      )
  );
}

function claimedIncrementCount(source) {
  return (
    maskSqlLiterals(source).match(
      /\bv_claimed_count\s*:=\s*v_claimed_count\s*\+\s*1\b/gi
    ) ?? []
  ).length;
}

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
  assert.equal(claimedIncrementCount(claim), 1);
  assert.equal(
    findEffectiveReserveUpdate(
      claim.replace(
        'v_claimed_count := v_claimed_count + 1;',
        'v_claimed_count := v_claimed_count + 1;\nv_claimed_count := v_claimed_count + 1;'
      )
    ),
    undefined
  );
  const neededAssignment =
    /\bv_needed\s*:=\s*v_qty\s*-\s*v_reserved_count\s*;/i;
  assert.match(claim, neededAssignment);
  assert.doesNotMatch(
    claim.replace(
      'v_needed := v_qty - v_reserved_count;',
      'v_needed := v_qty - v_reserved_count + 1;'
    ),
    neededAssignment
  );
  assert.ok(
    reservedCountQueries.every((query) =>
      (() => {
        const where = /\bWHERE\b([\s\S]*?);/i.exec(query)?.[1];
        return (
          where !== undefined &&
          isRequiredConjunct(where, /\border_item_id\s*=\s*p_order_item_id\b/i)
        );
      })()
    ),
    'reserved counts must stay scoped to the target order item'
  );
  const unsafeCount =
    'SELECT count(*)::integer INTO v_reserved_count FROM variant_inventory WHERE order_item_id = p_order_item_id OR order_id = p_order_id;';
  assert.equal(
    isRequiredConjunct(
      /\bWHERE\b([\s\S]*?);/i.exec(unsafeCount)?.[1] ?? '',
      /\border_item_id\s*=\s*p_order_item_id\b/i
    ),
    false
  );

  const reserveUnitUpdate =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([^;]*?)\s+WHERE\s+([^;]*);/gi;
  const reserveUpdate = findEffectiveReserveUpdate(claim);
  assert.ok(
    reserveUpdate &&
      /\bstatus\s*=\s*'reserved'/i.test(reserveUpdate[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(reserveUpdate[1]) &&
      /\border_item_id\s*=\s*p_order_item_id\b/i.test(reserveUpdate[1]) &&
      isRequiredConjunct(reserveUpdate[2], /\bid\s*=\s*v_unit\.id\b/i) &&
      hasOnlyUnitIdPredicate(reserveUpdate[2]) &&
      !/\bOR\b|\bFALSE\b|\bNOT\s+TRUE\b|\bIS\s+(?:FALSE|NOT\s+TRUE)\b/i.test(
        reserveUpdate[2]
      ),
    'each claimed unit must be transitioned by an effective scoped update'
  );
  assert.ok(
    reserveUpdate &&
      claim.indexOf(
        'v_claimed_count := v_claimed_count + 1',
        reserveUpdate.index
      ) > reserveUpdate.index,
    'claimed count must increment only after the reservation update'
  );
  assert.equal(
    (() => {
      const unsafe =
        "UPDATE public.variant_inventory SET status = 'reserved', order_id = p_order_id, order_item_id = p_order_item_id WHERE id = v_unit.id AND false;";
      const match = [...unsafe.matchAll(reserveUnitUpdate)].at(0);
      return (
        match !== null &&
        isRequiredConjunct(match[2], /\bid\s*=\s*v_unit\.id\b/i) &&
        !/\bFALSE\b/i.test(match[2])
      );
    })(),
    false
  );
  assert.equal(
    hasOnlyUnitIdPredicate("id = v_unit.id AND status = 'reserved'"),
    false
  );
  assert.equal(
    findEffectiveReserveUpdate(
      claim.replace(
        /UPDATE\s+public\.variant_inventory\s+SET\s+status\s*=\s*'reserved',[\s\S]*?WHERE\s+id\s*=\s*v_unit\.id;/i,
        (update) => `IF false THEN\n${update}\nEND IF;`
      )
    ),
    undefined
  );
  const whereOnlyAssignments = [
    ..."UPDATE variant_inventory SET updated_at = now() WHERE id = v_unit.id AND status = 'reserved' AND order_id = p_order_id AND order_item_id = p_order_item_id;".matchAll(
      reserveUnitUpdate
    ),
  ].at(0);
  assert.equal(
    whereOnlyAssignments !== null &&
      /\bstatus\s*=\s*'reserved'/i.test(whereOnlyAssignments[1]),
    false
  );
  const literalAssignments = [
    ...maskSqlLiterals(
      "UPDATE variant_inventory SET source = $$status = 'reserved', order_id = p_order_id, order_item_id = p_order_item_id$$ WHERE id = v_unit.id;",
      { preserveStrings: true }
    ).matchAll(reserveUnitUpdate),
  ].at(0);
  assert.equal(
    literalAssignments !== undefined &&
      /\bstatus\s*=\s*'reserved'/i.test(literalAssignments[1]),
    false
  );
});

test('serialized claims authorize callers and fail strict shortages before success', () => {
  const publicClaim = latestFunctionBody(
    'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)'
  );
  const authorization =
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]forbidden['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      publicClaim
    );
  const delegation =
    /RETURN\s+private\.claim_variant_inventory_units_for_order_item_internal\s*\(/i.exec(
      publicClaim
    );
  assert.ok(authorization, 'public claims must authorize the merchant');
  assert.ok(delegation, 'public claims must delegate to the internal claim');
  assert.ok(authorization.index < delegation.index);

  const claim = latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  const shortage =
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s+(?:\(\s*)?v_reserved_count\s*\+\s*v_claimed_count\s*(?:\s*\))?\s*<\s*v_qty\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]serialized_inventory_unavailable['"]/i.exec(
      claim
    );
  const success = /RETURN\s+v_fulfillment_data\s*;/i.exec(claim);
  assert.ok(shortage);
  assert.ok(success);
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      claim,
      shortage.index,
      shortage.index + shortage[0].indexOf('RAISE')
    ),
    true
  );
  assert.ok(shortage.index < success.index);
  const relocated = `${claim.replace(shortage[0], '')}\n${shortage[0]}`;
  assert.ok(
    relocated.lastIndexOf(shortage[0]) >
      /RETURN\s+v_fulfillment_data\s*;/i.exec(relocated).index
  );
});
