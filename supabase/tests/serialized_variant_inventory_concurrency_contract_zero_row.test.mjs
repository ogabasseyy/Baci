import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const { legacyDecrementMatches, legacyDecrementHasZeroRowHandling } =
  serializedInventoryContract;

test('requires an unconditional exception in the immediate zero-row handler', () => {
  const direct = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE stock_quantity >= stock_rec.total_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
  `);
  assert.equal(direct.length, 1);
  assert.equal(legacyDecrementHasZeroRowHandling(direct[0]), true);

  const nested = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE stock_quantity >= stock_rec.total_quantity;
    IF NOT FOUND THEN
      IF v_should_raise THEN
        RAISE EXCEPTION 'nested';
      END IF;
    END IF;
  `);
  assert.equal(nested.length, 1);
  assert.equal(legacyDecrementHasZeroRowHandling(nested[0]), false);

  const caseGated = legacyDecrementMatches(`
    UPDATE products SET stock_quantity = stock_quantity - 1 WHERE stock_quantity >= 1;
    IF NOT FOUND THEN
      CASE WHEN v_should_raise THEN RAISE EXCEPTION 'nested'; ELSE NULL; END CASE;
    END IF;
  `);
  assert.equal(legacyDecrementHasZeroRowHandling(caseGated[0]), false);
});
