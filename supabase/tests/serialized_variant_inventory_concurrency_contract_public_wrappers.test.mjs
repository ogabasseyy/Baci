import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const wrappers = [
  {
    signature:
      'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)',
    delegatePattern:
      /RETURN\s+private\s*\.\s*claim_variant_inventory_units_for_order_item_internal\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*,\s*p_order_item_id\s*\)\s*;/i,
  },
  {
    signature: 'public.confirm_order_inventory_reservations(uuid, uuid)',
    delegatePattern:
      /RETURN\s+private\s*\.\s*confirm_order_inventory_reservations\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*\)\s*;/i,
  },
];
const authorizationPattern =
  /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN\b/i;
const authorizationBlockPattern =
  /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+['"]forbidden['"][\s\S]*?END\s+IF\s*;/i;

function publicWrapperPreservesMerchantParameter(source, delegatePattern) {
  const normalizedSource =
    serializedInventorySqlParser.stripSqlComments(source);
  const executable = serializedInventorySqlParser.maskSqlLiterals(
    normalizedSource,
    { preserveStrings: true }
  );
  const code = serializedInventorySqlParser.maskSqlLiterals(normalizedSource);
  const authorization = authorizationBlockPattern.exec(executable);
  const authorizationOpening = authorizationPattern.exec(executable);
  let authorizationArms;
  try {
    authorizationArms = authorizationOpening
      ? serializedInventoryBranches.extractIfArms(
          executable,
          authorizationPattern
        )
      : undefined;
  } catch {
    return false;
  }
  const delegation = delegatePattern.exec(executable);
  if (
    !authorization ||
    !authorizationOpening ||
    !authorizationArms ||
    !/\bRAISE\s+EXCEPTION\s+['"]forbidden['"]/i.test(
      authorizationArms.thenBranch
    ) ||
    !delegation
  ) {
    return false;
  }
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
  for (const { signature, delegatePattern } of wrappers) {
    const source = serializedInventoryContract.latestFunctionBody(signature);
    assert.equal(
      publicWrapperPreservesMerchantParameter(source, delegatePattern),
      true
    );

    const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
      preserveStrings: true,
    });
    const delegation = delegatePattern.exec(executable);
    assert.ok(delegation);
    const reassigned = source.replace(
      delegation[0],
      `p_merchant_id := (SELECT merchant_id FROM public.orders WHERE id = p_order_id);\n${delegation[0]}`
    );
    assert.equal(
      publicWrapperPreservesMerchantParameter(reassigned, delegatePattern),
      false
    );

    const wrongDelegate = source.replace(
      delegatePattern,
      'RETURN private.release_order_inventory_units(p_merchant_id, p_order_id, p_target_status);'
    );
    assert.equal(
      publicWrapperPreservesMerchantParameter(wrongDelegate, delegatePattern),
      false,
      `${signature} must delegate to its exact private implementation`
    );

    const executableAuthorization = authorizationBlockPattern.exec(executable);
    assert.ok(executableAuthorization);
    const then = /\bTHEN\b/i.exec(executableAuthorization[0]);
    const end = /\bEND\s+IF\s*;\s*$/i.exec(executableAuthorization[0]);
    assert.ok(then);
    assert.ok(end);
    const inverted = source.replace(
      executableAuthorization[0],
      (block) =>
        `${block.slice(0, then.index + then[0].length)}\nNULL;\nELSE\n${block.slice(then.index + then[0].length, end.index)}${end[0]}`
    );
    assert.equal(
      publicWrapperPreservesMerchantParameter(inverted, delegatePattern),
      false,
      `${signature} must reject authorization moved to an ELSE arm`
    );
  }
});
