import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const fixtures = JSON.parse(
  readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8')
);
const core = JSON.parse(
  readFileSync(new URL('./core-scenarios.json', import.meta.url), 'utf8')
);
const cases = new Map(
  fixtures.cases.map((scenario) => [scenario.id, scenario])
);
const evidence = new Map(
  fixtures.bankEvidence.map((entry) => [entry.id, entry])
);

test('successful swaps reconcile each payment leg and restore only current stock', () => {
  assert.equal(cases.size, fixtures.cases.length);
  assert.equal(fixtures.synthetic, true);
  for (const { order, replacement, expected } of cases.values()) {
    assert.equal(order.currency, 'NGN');
    assert.ok(Number.isSafeInteger(order.totalMinor));
    assert.equal(order.line.quantity, replacement.quantity);
    const pools = fixtures.inventoryPools;
    assert.ok(pools[order.line.stockPoolId]);
    assert.ok(pools[replacement.stockPoolId]);

    if (!expected.eligible) {
      assert.equal(expected.newMoneyMovements, 0);
      continue;
    }

    const paid = order.payments.reduce((sum, leg) => sum + leg.amountMinor, 0);
    const delta = replacement.previewTotalMinor - paid;
    assert.equal(order.totalMinor, paid);
    assert.equal(expected.amendedTotalMinor, replacement.previewTotalMinor);
    assert.equal(expected.adjustmentMinor, delta);
    assert.equal(expected.topUpMinor, Math.max(delta, 0));
    assert.equal(expected.amendmentRefundMinor, Math.max(-delta, 0));
    assert.equal(expected.initialHold, delta !== 0);
    const captured = new Map(
      order.payments.map((leg) => [leg.id, leg.amountMinor])
    );

    for (const refund of expected.cancellationRefunds) {
      if (captured.has(refund.paymentId)) {
        assert.equal(
          refund.amountMinor,
          captured.get(refund.paymentId) - expected.amendmentRefundMinor
        );
      } else {
        const transfer = evidence.get(refund.paymentId);
        assert.equal(transfer.direction, 'inbound');
        assert.equal(refund.amountMinor, transfer.amountMinor);
        assert.equal(refund.amountMinor, expected.topUpMinor);
      }
    }

    assert.equal(
      expected.cancellationRefunds.reduce(
        (sum, leg) => sum + leg.amountMinor,
        0
      ),
      expected.amendedTotalMinor
    );
    assert.deepEqual(expected.stockDeltas.onSwap, {
      [order.line.stockPoolId]: 1,
      [replacement.stockPoolId]: -1,
    });
    assert.deepEqual(expected.stockDeltas.onCancellation, {
      [replacement.stockPoolId]: 1,
    });
  }
});

test('serialized fixtures model an active confirmed hold and exact unit transitions', () => {
  const scenario = cases.get('equal-price-serialized');
  const oldUnit = scenario.order.line.inventoryUnit;
  const newUnit =
    fixtures.inventoryPools[scenario.replacement.stockPoolId].unitId;
  assert.equal(oldUnit.status, 'reserved');
  assert.equal(oldUnit.reservationExpiresAt, null);
  assert.equal(oldUnit.soldAt, null);
  assert.equal(oldUnit.orderItemId, scenario.order.line.id);
  assert.deepEqual(scenario.expected.serialTransitions, [
    {
      unitId: oldUnit.id,
      from: 'reserved',
      to: 'available',
      action: 'confirm',
    },
    { unitId: newUnit, from: 'available', to: 'reserved', action: 'confirm' },
    { unitId: newUnit, from: 'reserved', to: 'available', action: 'cancel' },
  ]);
  assert.equal(cases.get('serialized-unit-sold').expected.eligible, false);
});

test('Task 2 fixtures pin conflict inputs to explicit no-write and replay outcomes', () => {
  const byId = new Map(core.cases.map((scenario) => [scenario.id, scenario]));
  assert.equal(byId.size, core.cases.length);
  for (const scenario of byId.values()) {
    assert.ok(cases.has(scenario.orderCaseId), scenario.id);
    assert.ok(scenario.steps.length > 0, scenario.id);
  }
  for (const id of [
    'cross-tenant-confirm',
    'stale-preview',
    'stale-preview-after-pause',
    'inventory-mutation-rollback',
  ]) {
    const { expected } = byId.get(id);
    assert.equal(expected.newAmendments, 0, id);
    assert.deepEqual(expected.stockDeltas, {}, id);
    assert.equal(expected.newOrderRevisions, 0, id);
  }
  assert.equal(
    byId.get('replay-after-expiry-and-pause').expected.sameAmendmentId,
    true
  );
  const race = byId.get('last-unit-race');
  assert.equal(race.expected.winningConfirmations, 1);
  assert.equal(race.expected.losingConfirmations, 1);
  assert.equal(race.expected.replacementAvailableAfter, 0);
  assert.equal(race.expected.originalUnitsReleased, 1);
  assert.notEqual(
    race.inputs.secondOrder.originalUnitId,
    cases.get(race.orderCaseId).order.line.inventoryUnit.id
  );
  const preserve = byId.get('preserve-unrelated-serialized-line');
  assert.equal(
    preserve.inputs.orderTotalMinor,
    cases.get(preserve.orderCaseId).order.totalMinor +
      preserve.inputs.additionalLine.totalMinor
  );
  assert.equal(
    preserve.inputs.originalPaymentMinor,
    preserve.inputs.orderTotalMinor
  );
  assert.equal(
    preserve.inputs.previewTotalMinor,
    preserve.inputs.orderTotalMinor
  );
  assert.equal(
    preserve.expected.unrelatedUnitId,
    preserve.inputs.additionalLine.inventoryUnit.id
  );
  assert.equal(
    preserve.expected.unrelatedOrderItemId,
    preserve.inputs.additionalLine.id
  );
  assert.equal(preserve.expected.unrelatedUnitStatus, 'reserved');
  assert.equal(preserve.expected.unrelatedUnitMovements, 0);
});

test('claim recovery fixtures preserve funding and separately test mismatched evidence', () => {
  const byId = new Map(
    fixtures.reconciliationCases.map((scenario) => [scenario.id, scenario])
  );
  const early = byId.get('early-capture');
  const stale = byId.get('stale-capture');
  assert.deepEqual(early.capture, early.initializationClaim);
  assert.equal(early.orderOverrides.paymentStatus, 'unpaid');
  assert.equal(stale.expected.newOrderAllocations, 0);
  for (const id of [
    'capture-wrong-account',
    'capture-wrong-currency',
    'capture-wrong-amount',
  ]) {
    const scenario = byId.get(id);
    const mismatches = Object.keys(scenario.initializationClaim).filter(
      (key) => scenario.initializationClaim[key] !== scenario.capture[key]
    );
    assert.deepEqual(mismatches, [scenario.mismatchField], id);
    assert.equal(scenario.expected.newOrderAllocations, 0, id);
    assert.equal(scenario.expected.claimState, 'review', id);
    assert.equal(scenario.expected.amendmentAllowed, false, id);
  }
});
