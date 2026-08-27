import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryDecrementGuards } from './serialized_variant_inventory_concurrency_contract_decrement_guards.mjs';

test('public decrement RPCs reject nonpositive quantities and unauthorized merchants', () => {
  for (const functionName of [
    'public.decrement_product_stock(uuid, integer)',
    'public.decrement_variant_stock(uuid, integer)',
  ]) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(body),
      true
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(body),
      true
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        body.replace(
          /FROM\s+public\.products\s+AS\s+p/i,
          'FROM public.merchants AS p'
        )
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasUnlimitedStockReturn(body),
      true
    );
    assert.equal(
      serializedInventoryDecrementGuards.decrementsRequestedQuantity(body),
      true
    );
    assert.equal(
      serializedInventoryDecrementGuards.decrementsRequestedQuantity(
        body.replace(/\bquantity_param\b/gi, 'quantity_param * 2')
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(
        body.replace(/IF\s+quantity_param\s*<=\s*0[\s\S]*?END\s+IF\s*;/i, '')
      ),
      false
    );
    const quantityGuard =
      /IF\s+quantity_param\s*<=\s*0\s+THEN[\s\S]*?END\s+IF\s*;/i.exec(body);
    assert.ok(quantityGuard);
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(
        `${body.replace(quantityGuard[0], '')}\n${quantityGuard[0]}`
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(
        body.replace(
          quantityGuard[0],
          `IF false THEN\n${quantityGuard[0]}\nEND IF;`
        )
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(
        body.replace(
          quantityGuard[0],
          `IF quantity_param <= 0 THEN\n  NULL;\nELSE\n  RETURN;\nEND IF;`
        )
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        body.replace(
          /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\)[\s\S]*?END\s+IF\s*;/i,
          ''
        )
      ),
      false
    );
    const authorization =
      /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\)[\s\S]*?END\s+IF\s*;/i.exec(
        body
      );
    assert.ok(authorization);
    const targetParameter = body.includes('variant_id_param')
      ? 'variant_id_param'
      : 'product_id_param';
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        body.replace(
          authorization[0],
          `SELECT m.merchant_id INTO v_merchant_id
           FROM public.merchants AS m
           WHERE m.id = ${targetParameter};
           ${authorization[0]}`
        )
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        `${body.replace(authorization[0], '')}\n${authorization[0]}`
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        body.replace(
          authorization[0],
          `IF false THEN\n${authorization[0]}\nEND IF;`
        )
      ),
      false
    );
    const unlimitedStockReturn =
      /IF\s+NOT\s+COALESCE\s*\(\s*v_manage_stock[\s\S]*?END\s+IF\s*;/i.exec(
        body
      );
    assert.ok(unlimitedStockReturn);
    assert.equal(
      serializedInventoryDecrementGuards.hasUnlimitedStockReturn(
        body.replace(unlimitedStockReturn[0], '')
      ),
      false
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasUnlimitedStockReturn(
        body.replace(
          unlimitedStockReturn[0],
          `IF false THEN\n${unlimitedStockReturn[0]}\nEND IF;`
        )
      ),
      false
    );
  }
});
