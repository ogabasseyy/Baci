import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { isRequiredConjunct, maskSqlLiterals } = serializedInventorySqlParser;

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
  const reserveUpdate = [
    ...maskSqlLiterals(claim, { preserveStrings: true }).matchAll(
      reserveUnitUpdate
    ),
  ].find(
    (match) =>
      /\bstatus\s*=\s*'reserved'/i.test(match[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(match[1]) &&
      /\border_item_id\s*=\s*p_order_item_id\b/i.test(match[1])
  );
  assert.ok(
    reserveUpdate &&
      /\bstatus\s*=\s*'reserved'/i.test(reserveUpdate[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(reserveUpdate[1]) &&
      /\border_item_id\s*=\s*p_order_item_id\b/i.test(reserveUpdate[1]) &&
      isRequiredConjunct(reserveUpdate[2], /\bid\s*=\s*v_unit\.id\b/i) &&
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
