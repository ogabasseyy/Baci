import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const wrappers = [
  'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)',
  'public.confirm_order_inventory_reservations(uuid, uuid)',
];

function publicWrapperPreservesMerchantParameter(source) {
  const normalizedSource =
    serializedInventorySqlParser.stripSqlComments(source);
  const executable = serializedInventorySqlParser.maskSqlLiterals(
    normalizedSource,
    { preserveStrings: true }
  );
  const code = serializedInventorySqlParser.maskSqlLiterals(normalizedSource);
  const authorization =
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+['"]forbidden['"][\s\S]*?END\s+IF\s*;/i.exec(
      executable
    );
  const delegation =
    /RETURN\s+private\s*\.\s*[a-z_][a-z0-9_]*\s*\(\s*p_merchant_id\b[\s\S]*?;/i.exec(
      executable
    );
  if (!authorization || !delegation) return false;
  const between = code.slice(
    authorization.index + authorization[0].length,
    delegation.index
  );
  return (
    !/\bp_merchant_id\s*(?::=|=)/i.test(between) &&
    !/\bINTO\s+p_merchant_id\b/i.test(between) &&
    serializedInventoryControlFlow.dominatesControlFlow(
      executable,
      authorization.index,
      delegation.index
    )
  );
}

test('public inventory wrappers preserve the authorized merchant parameter', () => {
  for (const signature of wrappers) {
    const source = serializedInventoryContract.latestFunctionBody(signature);
    assert.equal(publicWrapperPreservesMerchantParameter(source), true);

    const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
      preserveStrings: true,
    });
    const delegation =
      /RETURN\s+private\s*\.\s*[a-z_][a-z0-9_]*\s*\(\s*p_merchant_id\b[\s\S]*?;/i.exec(
        executable
      );
    assert.ok(delegation);
    const reassigned = source.replace(
      delegation[0],
      `p_merchant_id := (SELECT merchant_id FROM public.orders WHERE id = p_order_id);\n${delegation[0]}`
    );
    assert.equal(publicWrapperPreservesMerchantParameter(reassigned), false);
  }
});
