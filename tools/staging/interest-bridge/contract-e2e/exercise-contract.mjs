import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { CONTRACT_E2E } from './constants.mjs';
import { createContractHarness } from './contract-harness.mjs';
import { createContractReport } from './report.mjs';

export async function exerciseContract(
  check = (_name, run) => Promise.resolve().then(run)
) {
  const harness = createContractHarness();
  const completed = [];
  const verify = async (name, run) => {
    await check(name, run);
    completed.push(name);
  };
  const assertUnpaid = () => {
    const snapshot = harness.snapshot();
    assert.equal(snapshot.principalKobo, 10000);
    for (const field of [
      'paidInterestKobo',
      'interestReceipts',
      'allocations',
      'notifications',
      'deliveries',
    ])
      assert.equal(snapshot[field], 0);
  };
  const assertPaidOnce = () => {
    const snapshot = harness.snapshot();
    assert.equal(snapshot.principalKobo, 10000);
    assert.equal(snapshot.paidInterestKobo, 733);
    assert.deepEqual(snapshot.payoutEconomics, {
      gross: 814,
      tax: 81,
      net: 733,
    });
    for (const field of ['interestReceipts', 'allocations', 'notifications'])
      assert.equal(snapshot[field], 1);
    assert.equal(snapshot.deliveries, 0);
  };
  try {
    await verify(
      'provider-supplied fixture retains gross814 tax81 net733 and starts unpaid',
      () => {
        const data = harness.payout.eventData;
        assert.equal(data.amount, 733);
        assert.equal(data.break_down.gross_interest_payout, 814);
        assert.equal(data.break_down.withholding_tax, 81);
        assert.equal(data.break_down.net_interest_payout, 733);
        assertUnpaid();
      }
    );

    await verify(
      'bad HMAC and raw-byte tampering reject before durable receipt storage',
      async () => {
        const invalid = await harness.transport.submit(
          harness.raw,
          '0'.repeat(128)
        );
        assert.equal(invalid.status, 200);
        assert.equal(invalid.body.received, false);
        assert.equal(invalid.body.code, 'PIGGYVEST_INVALID_SIGNATURE');
        const signature = createHmac('sha512', CONTRACT_E2E.signingSecret)
          .update(harness.raw)
          .digest('hex');
        const tampered = await harness.transport.submit(
          Buffer.concat([harness.raw, Buffer.from(' ')]),
          signature
        );
        assert.equal(tampered.body.received, false);
        assert.equal(harness.snapshot().sealedReceipts, 0);
        assertUnpaid();
      }
    );

    await verify(
      'fractional pending accrual rechecks original signature and stays nonspendable',
      async () => {
        assert.equal(
          (await harness.transport.submit(harness.fractional)).body.received,
          true
        );
        const result = await harness.worker.run();
        assert.equal(result.processed, 1);
        assert.equal(result.retryable, 0);
        assert.equal(result.quarantined, 0);
        const projection = harness.readProjection();
        assert.equal(projection.accruals.observations.length, 1);
        assert.equal(
          projection.accruals.observations[0].amountKobo,
          CONTRACT_E2E.fractionalKobo
        );
        assert.equal(projection.accruals.observations[0].spendable, false);
        assert.equal(projection.accruals.spendable, false);
        assert.equal(projection.earnings.credited_interest_kobo, 0);
        assert.equal(projection.projected.savingsBalance, 100);
        assert.equal(projection.inbox.notifications.length, 0);
        assertUnpaid();
      }
    );

    await verify(
      'fresh foreign-wallet payout is refused by exact policy without credit or notification',
      async () => {
        const foreign = structuredClone(harness.payout);
        foreign.eventId = 'synthetic-foreign-event';
        foreign.eventData.id = '80000000-0000-4000-8000-000000000001';
        foreign.eventData.destination_wallet =
          '90000000-0000-4000-8000-000000000001';
        foreign.pvb_destination_wallet = foreign.eventData.destination_wallet;
        assert.equal(
          (await harness.transport.submit(Buffer.from(JSON.stringify(foreign))))
            .body.received,
          true
        );
        const result = await harness.worker.run();
        assert.equal(result.retryable, 1);
        assert.equal(result.processed, 0);
        assert.equal(harness.outcomes.at(-1), 'deferred');
        assertUnpaid();
      }
    );

    await verify(
      'actual application rolls back allocation credit and notification when receipt commit fails',
      async () => {
        assert.equal(
          (await harness.transport.submit(harness.raw)).body.received,
          true
        );
        harness.database.sql(`
        CREATE FUNCTION public.synthetic_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic receipt commit failure'; END $$;
        CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON piggyvest_savings_ledger.interest_receipts
          FOR EACH ROW EXECUTE FUNCTION public.synthetic_receipt_failure();
      `);
        const result = await harness.worker.run();
        assert.equal(result.retryable, 1);
        assert.equal(result.processed, 0);
        assertUnpaid();
        harness.database.sql(`
        DROP TRIGGER synthetic_receipt_failure ON piggyvest_savings_ledger.interest_receipts;
        DROP FUNCTION public.synthetic_receipt_failure();
        UPDATE public.piggyvest_staging_receipts SET next_attempt_at=clock_timestamp()
          WHERE payload_sha256=encode(sha256(decode('${harness.raw.toString('hex')}', 'hex')), 'hex');
      `);
      }
    );

    await verify(
      'signed payout credits net733 once even when transport acknowledgement is lost',
      async () => {
        harness.transport.loseNextResolution();
        const result = await harness.worker.run();
        assert.equal(result.resolutionFailures, 1);
        assert.equal(result.processed, 0);
        assert.equal(
          harness.outcomes.filter((outcome) => outcome === 'applied').length,
          1
        );
        assertPaidOnce();
      }
    );

    await verify(
      'PostgreSQL restart and expired-lease replay are duplicate-safe',
      async () => {
        harness.database.restart();
        harness.database.sql(`UPDATE public.piggyvest_staging_receipts
        SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE status='processing'`);
        const result = await harness.worker.run();
        assert.equal(result.processed, 1);
        assert.equal(result.resolutionFailures, 0);
        assert.equal(harness.outcomes.at(-1), 'duplicate');
        const duplicate = await harness.transport.submit(harness.raw);
        assert.equal(duplicate.body.received, true);
        assert.equal(duplicate.body.duplicate, true);
        assert.equal((await harness.worker.run()).claimed, 0);
        assertPaidOnce();
      }
    );

    await verify(
      'eight concurrent real SQL replays and alternate event delivery do not double-credit or notify',
      async () => {
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, () =>
            harness.replayInterest(harness.payout)
          )
        );
        assert.equal(
          outcomes.filter((outcome) => outcome === 'duplicate').length,
          8
        );
        const alternate = {
          ...harness.payout,
          eventId: 'synthetic-alternate-delivery',
        };
        assert.equal(
          (
            await harness.transport.submit(
              Buffer.from(JSON.stringify(alternate))
            )
          ).body.received,
          true
        );
        assert.equal((await harness.worker.run()).processed, 1);
        assert.equal(harness.outcomes.at(-1), 'duplicate');
        assertPaidOnce();
      }
    );

    await verify(
      'foreign-wallet collision against credited payout is durably quarantined',
      async () => {
        const collision = structuredClone(harness.payout);
        collision.eventId = 'synthetic-foreign-collision';
        collision.eventData.destination_wallet =
          '90000000-0000-4000-8000-000000000001';
        collision.pvb_destination_wallet =
          collision.eventData.destination_wallet;
        assert.equal(
          (
            await harness.transport.submit(
              Buffer.from(JSON.stringify(collision))
            )
          ).body.received,
          true
        );
        const result = await harness.worker.run();
        assert.equal(result.quarantined, 1);
        assert.equal(result.processed, 0);
        assert.equal(
          harness.database.sql(
            'SELECT reason FROM public.piggyvest_staging_replay_quarantine'
          ),
          'conflict'
        );
        assertPaidOnce();
      }
    );

    await verify(
      'authenticated notification and mobile goal projections expose paid net only and enforce customer scope',
      () => {
        const projection = harness.readProjection();
        assert.equal(projection.earnings.credited_interest_kobo, 733);
        assert.deepEqual(projection.earnings.goal_interest_kobo, [
          { goal_id: CONTRACT_E2E.goalId, credited_interest_kobo: 733 },
        ]);
        assert.equal(projection.projected.savingsBalance, 107.33);
        assert.equal(projection.inbox.notifications.length, 1);
        const notification = projection.inbox.notifications[0];
        assert.equal(notification.type, 'interest_credited');
        assert.equal(notification.goalId, CONTRACT_E2E.goalId);
        assert.equal(notification.body.includes('₦7.33'), true);
        assert.equal(notification.body.includes('₦8.14'), false);
        assert.equal(notification.body.includes('confirmed'), true);
        assert.equal(notification.readAt, null);
        assert.throws(() =>
          harness.database.sql(`BEGIN; SET LOCAL ROLE authenticated;
        SET LOCAL request.jwt.claim.sub='${CONTRACT_E2E.userId}';
        SELECT public.get_customer_savings_notifications('10000000-0000-4000-8000-000000000002'); ROLLBACK;`)
        );
        harness.database.sql(`BEGIN; SET LOCAL ROLE authenticated;
        SET LOCAL request.jwt.claim.sub='${CONTRACT_E2E.userId}';
        SELECT public.mark_customer_savings_notification_read('${CONTRACT_E2E.merchantId}', '${notification.id}'); COMMIT;`);
        assert.notEqual(
          harness.readProjection().inbox.notifications[0].readAt,
          null
        );
        assertPaidOnce();
      }
    );

    return createContractReport(harness, completed);
  } finally {
    harness.close();
  }
}
