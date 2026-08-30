import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';

const { extractIfArms } = serializedInventoryBranches;
const { latestFunctionBody } = serializedInventoryContract;
const { isReachable } = serializedInventoryControlFlow;
const shortfallTarget =
  /^\s*IF\s*\(\s*v_reserved_count\s*\+\s*v_claimed_in_loop\s*\)\s*<\s*v_item\.quantity\s+THEN\b/im;
const strictTarget =
  /^\s*IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+THEN\b/im;
const lossException =
  /v_exceptions\s*:=\s*v_exceptions\s*\|\|[\s\S]*?'late_payment_reservation_lost'\s*\)\s*;/i;

test('payment-loss exceptions stay in the strict shortage arm', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const shortfall = extractIfArms(confirm, shortfallTarget);
  const strict = extractIfArms(shortfall.thenBranch, strictTarget);
  const append = lossException.exec(strict.thenBranch);
  assert.ok(append);
  assert.equal(isReachable(strict.thenBranch, append.index), true);

  const strictBlock =
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      confirm
    );
  assert.ok(strictBlock);
  const then = /\bTHEN\b/i.exec(strictBlock[0]);
  const end = /\bEND\s+IF\s*;\s*$/i.exec(strictBlock[0]);
  assert.ok(then);
  assert.ok(end);
  const inverted = confirm.replace(
    strictBlock[0],
    (block) =>
      `${block.slice(0, then.index + then[0].length)}\nNULL;\nELSE\n${block.slice(then.index + then[0].length, end.index)}${end[0]}`
  );
  const invertedShortfall = extractIfArms(inverted, shortfallTarget);
  const invertedStrict = extractIfArms(
    invertedShortfall.thenBranch,
    strictTarget
  );
  assert.doesNotMatch(invertedStrict.thenBranch, lossException);
});

test('strict shortage exceptions cannot hide in a zero-iteration loop', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const unreachable = confirm.replace(
    lossException,
    (append) =>
      `FOR v_unit IN SELECT NULL WHERE false LOOP\n${append}\nEND LOOP;`
  );
  const shortfall = extractIfArms(unreachable, shortfallTarget);
  const strict = extractIfArms(shortfall.thenBranch, strictTarget);
  const appendMatch = lossException.exec(strict.thenBranch);
  assert.ok(appendMatch);
  assert.equal(isReachable(strict.thenBranch, appendMatch.index), false);
});
