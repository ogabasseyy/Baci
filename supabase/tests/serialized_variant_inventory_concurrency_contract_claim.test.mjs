import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryClaim } from './serialized_variant_inventory_concurrency_contract_claim.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { isRequiredConjunct, maskSqlLiterals } = serializedInventorySqlParser;
const {
  claimedIncrementCount,
  findEffectiveExcessRelease,
  findEffectiveReserveUpdate,
  hasOnlyUnitIdPredicate,
} = serializedInventoryClaim;

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
  assert.equal(
    findEffectiveReserveUpdate(
      claim.replace(/\s*reservation_expires_at\s*=\s*CASE[\s\S]*?END,?/i, '')
    ),
    undefined
  );
  assert.equal(
    findEffectiveReserveUpdate(
      claim.replace(/\s*branch_id\s*=\s*v_unit_branch_id\s*,?/i, '')
    ),
    undefined
  );
  const reserveStatement =
    /UPDATE\s+public\.variant_inventory\s+SET\s+status\s*=\s*'reserved',[\s\S]*?WHERE\s+id\s*=\s*v_unit\.id;/i.exec(
      claim
    );
  assert.ok(reserveStatement);
  assert.equal(
    findEffectiveReserveUpdate(
      claim
        .replace(reserveStatement[0], '')
        .replace('FOR v_unit IN', `${reserveStatement[0]}\nFOR v_unit IN`)
    ),
    undefined
  );
  assert.ok(findEffectiveExcessRelease(claim));
  assert.equal(
    findEffectiveExcessRelease(
      claim.replace(
        /UPDATE\s+public\.variant_inventory\s+SET\s+status\s*=\s*'available',[\s\S]*?WHERE\s+id\s*=\s*v_unit_id\s*;/i,
        (update) => `IF false THEN\n${update}\nEND IF;`
      )
    ),
    undefined
  );
  assert.equal(
    findEffectiveExcessRelease(
      claim.replace(
        "WHERE order_item_id = p_order_item_id AND status = 'reserved'",
        "WHERE status = 'available'"
      )
    ),
    undefined
  );
  const fulfillmentSnapshot =
    /UPDATE\s+public\.order_items\s+SET\s+fulfillment_data\s*=\s*v_fulfillment_data\s+WHERE\s+id\s*=\s*p_order_item_id\s*;/i;
  assert.match(claim, fulfillmentSnapshot);
  assert.doesNotMatch(
    claim.replace(fulfillmentSnapshot, 'PERFORM 1;'),
    fulfillmentSnapshot
  );
  const neededAssignment =
    /\bv_needed\s*:=\s*v_qty\s*-\s*v_reserved_count\s*;/i;
  const needed = neededAssignment.exec(claim);
  const neededSelector = /\bLIMIT\s+v_needed\b/i.exec(claim);
  assert.ok(needed);
  assert.ok(neededSelector);
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      claim,
      needed.index,
      neededSelector.index
    ),
    true
  );
  assert.doesNotMatch(
    claim.replace(
      'v_needed := v_qty - v_reserved_count;',
      'v_needed := v_qty - v_reserved_count + 1;'
    ),
    neededAssignment
  );
  const unreachableNeeded = claim.replace(
    needed[0],
    `v_needed := v_qty - v_reserved_count + 1;\nIF false THEN\n${needed[0]}\nEND IF;`
  );
  const unreachableAssignment = neededAssignment.exec(unreachableNeeded);
  const unreachableSelector = /\bLIMIT\s+v_needed\b/i.exec(unreachableNeeded);
  assert.ok(unreachableAssignment);
  assert.ok(unreachableSelector);
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      unreachableNeeded,
      unreachableAssignment.index,
      unreachableSelector.index
    ),
    false
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
  assert.equal(
    findEffectiveReserveUpdate(
      claim.replace(
        /UPDATE\s+public\.variant_inventory\s+SET\s+status\s*=\s*'reserved',[\s\S]*?WHERE\s+id\s*=\s*v_unit\.id;/i,
        (update) =>
          `${update}\nUPDATE public.variant_inventory SET status = 'reserved', updated_at = now() WHERE status = 'available';`
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
