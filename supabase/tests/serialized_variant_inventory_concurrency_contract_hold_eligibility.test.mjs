import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;

function hasConfirmedHoldEligibility(source, orderPrefix) {
  const paymentStatus = `${orderPrefix}payment_status`;
  const paymentMethod = `${orderPrefix}payment_method`;
  const eligibility = new RegExp(
    `IF\\s+${paymentStatus}\\s+IN\\s*\\(\\s*'paid'\\s*,\\s*'bnpl_approved'\\s*\\)\\s+OR\\s*\\(\\s*lower\\(trim\\(${paymentMethod}\\)\\)\\s+IN\\s*\\(\\s*'pod'\\s*,\\s*'pay_on_delivery'\\s*\\)\\s+AND\\s+${paymentStatus}\\s*=\\s*'pending'\\s*\\)\\s+THEN\\b`,
    'i'
  );
  const normalized = serializedInventorySqlParser.stripSqlComments(source);
  const match = eligibility.exec(normalized);
  if (!match) return false;
  let branches;
  try {
    branches = serializedInventoryBranches.extractIfArms(
      normalized,
      eligibility
    );
  } catch {
    return false;
  }
  const assignment = /v_is_confirmed_hold\s*:=\s*true\s*;/i.exec(
    branches.thenBranch
  );
  const assignmentIndex =
    assignment && match.index + match[0].length + assignment.index;
  return Boolean(
    /v_is_confirmed_hold\s+boolean\s*:=\s*false\s*;/i.test(normalized) &&
      assignment &&
      serializedInventoryControlFlow.isReachable(normalized, assignmentIndex)
  );
}

test('claim and confirmation preserve protected wrapper modes and hold eligibility', () => {
  const publicClaim = latestFunctionBody(
    'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)'
  );
  const publicConfirm = latestFunctionBody(
    'public.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.match(publicClaim, /SECURITY\s+DEFINER/i);
  assert.match(publicConfirm, /SECURITY\s+DEFINER/i);
  assert.doesNotMatch(
    publicClaim.replace(/SECURITY\s+DEFINER/i, 'SECURITY INVOKER'),
    /SECURITY\s+DEFINER/i
  );
  assert.doesNotMatch(
    publicConfirm.replace(/SECURITY\s+DEFINER/i, 'SECURITY INVOKER'),
    /SECURITY\s+DEFINER/i
  );

  for (const [functionName, prefix] of [
    [
      'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)',
      'v_',
    ],
    ['private.confirm_order_inventory_reservations(uuid, uuid)', 'v_order\\.'],
  ]) {
    const body = latestFunctionBody(functionName);
    assert.equal(hasConfirmedHoldEligibility(body, prefix), true);
    assert.equal(
      hasConfirmedHoldEligibility(
        body.replace(
          'v_is_confirmed_hold boolean := false;',
          'v_is_confirmed_hold boolean := true;'
        ),
        prefix
      ),
      false
    );
    assert.equal(
      hasConfirmedHoldEligibility(
        body.replace(
          /IF\s+(?:v_|v_order\.)payment_status\s+IN[\s\S]*?v_is_confirmed_hold\s*:=\s*true\s*;/i,
          (eligibilityBlock) => `IF false THEN\n${eligibilityBlock}\nEND IF;`
        ),
        prefix
      ),
      false
    );
    assert.equal(
      hasConfirmedHoldEligibility(
        `
          DECLARE
            v_is_confirmed_hold boolean := false;
          BEGIN
            IF ${prefix}payment_status IN ('paid', 'bnpl_approved')
               OR (lower(trim(${prefix}payment_method)) IN ('pod', 'pay_on_delivery')
                   AND ${prefix}payment_status = 'pending') THEN
              NULL;
            ELSE
              v_is_confirmed_hold := true;
            END IF;
          END;
        `,
        prefix
      ),
      false
    );
  }
});
