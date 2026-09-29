import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryClaim } from './serialized_variant_inventory_concurrency_contract_claim.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { maskSqlLiterals } = serializedInventorySqlParser;
const { strictShortagePrecedesSuccess } = serializedInventoryClaim;

test('serialized claims authorize callers and fail strict shortages before success', () => {
  const publicClaim = latestFunctionBody(
    'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)'
  );
  const executablePublicClaim = maskSqlLiterals(publicClaim, {
    preserveStrings: true,
  });
  const authorization =
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]forbidden['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      executablePublicClaim
    );
  const delegation =
    /RETURN\s+private\.claim_variant_inventory_units_for_order_item_internal\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*,\s*p_order_item_id\s*\)\s*;/i.exec(
      executablePublicClaim
    );
  assert.ok(authorization, 'public claims must authorize the merchant');
  assert.ok(delegation, 'public claims must delegate to the internal claim');
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      executablePublicClaim,
      authorization.index,
      delegation.index
    ),
    true
  );
  assert.doesNotMatch(
    executablePublicClaim.replace(
      /(RETURN\s+private\.claim_variant_inventory_units_for_order_item_internal[\s\S]*?)p_order_item_id/i,
      '$1p_order_id'
    ),
    /RETURN\s+private\.claim_variant_inventory_units_for_order_item_internal\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*,\s*p_order_item_id\s*\)\s*;/i
  );
  const decoyClaim = maskSqlLiterals(
    publicClaim.replace(
      authorization[0],
      `PERFORM $decoy$${authorization[0]}$decoy$;`
    ),
    { preserveStrings: true }
  );
  assert.doesNotMatch(decoyClaim, /RAISE\s+EXCEPTION\s+['"]forbidden['"]/i);

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
  assert.equal(strictShortagePrecedesSuccess(claim), true);
  assert.equal(
    strictShortagePrecedesSuccess(
      claim.replace(shortage[0], `IF false THEN\n${shortage[0]}\nEND IF;`)
    ),
    false
  );
  assert.equal(
    strictShortagePrecedesSuccess(
      claim.replace(
        /RAISE\s+EXCEPTION\s+'serialized_inventory_unavailable'[^;]*;/i,
        (raise) => `CASE WHEN false THEN ${raise} END CASE;`
      )
    ),
    false
  );
  const swallowedShortage = claim.replace(
    /END;\s*$/,
    `EXCEPTION WHEN SQLSTATE '55000' THEN RETURN v_fulfillment_data;\nEND;`
  );
  assert.notEqual(swallowedShortage, claim);
  assert.equal(strictShortagePrecedesSuccess(swallowedShortage), false);
  const swallowedOthers = claim.replace(
    /END;\s*$/,
    `EXCEPTION WHEN OTHERS THEN RETURN v_fulfillment_data;\nEND;`
  );
  assert.notEqual(swallowedOthers, claim);
  assert.equal(strictShortagePrecedesSuccess(swallowedOthers), false);
  const relocated = `${claim.replace(shortage[0], '')}\n${shortage[0]}`;
  assert.ok(
    relocated.lastIndexOf(shortage[0]) >
      /RETURN\s+v_fulfillment_data\s*;/i.exec(relocated).index
  );
});
