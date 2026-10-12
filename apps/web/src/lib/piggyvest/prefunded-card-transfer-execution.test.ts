import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPrefundedCardExecution } from './prefunded-card-execution';
import { prefundedCardTransferVerificationFixture as fixture } from './prefunded-card-transfer-verification.test-fixture';

vi.mock('server-only', () => ({}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T16:00:00.000Z');
});
afterEach(() => vi.useRealTimers());

function options(ownership: unknown = fixture.ownership) {
  const execute = vi.fn().mockImplementation(async (statement: string) => {
    let result: unknown;
    if (statement.includes('.claim_due('))
      result = [
        {
          operationId: fixture.claim.operationId,
          token: '20000000-0000-4000-8000-000000000001',
        },
      ];
    else if (statement.includes('.read_operation('))
      result = {
        operationId: fixture.claim.operationId,
        collectionStatus: 'verified_success',
        transferStatus: 'dispatching',
        projectionStatus: 'unapplied',
        collectionFence: 1,
        transferFence: 1,
      };
    else if (statement.includes('.claim_reconciliation('))
      result = {
        outcome: 'verify_only',
        operationId: fixture.claim.operationId,
        fence: 2,
        leg: 'transfer',
        token: '20000000-0000-4000-8000-000000000002',
        request: fixture.claim,
      };
    else if (statement.includes('.complete_reconciliation('))
      result = 'verified_success';
    else if (statement.includes('.finish_dispatch(')) result = true;
    else throw new Error('Unexpected SQL authority');
    return { rows: [{ result }] };
  });
  const fetchImplementation = vi
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json(
        url.includes('/transaction/verify?')
          ? fixture.transaction
          : url.endsWith('/wallet_source')
            ? fixture.sourceWallet
            : fixture.destinationWallet
      )
    );
  return {
    worker: {
      environment: 'staging',
      integrationId: fixture.claim.integrationId,
      merchantId: fixture.claim.merchantId,
      treasuryBindingId: fixture.claim.treasuryBindingId,
      businessId: fixture.claim.businessId,
      expectedSystemId: '123',
    },
    provider: fixture.settings,
    evidence: {
      integrationId: fixture.claim.integrationId,
      systemIdentifier: '123',
      webhookSecret: 'synthetic-receipt-key',
      piggyvest: fixture.settings.piggyvest,
    },
    execute,
    evidenceExecute: vi
      .fn()
      .mockResolvedValue({ rows: [{ result: { outcome: 'deferred' } }] }),
    fetchImplementation,
    resolveTransferOwnership: vi.fn().mockResolvedValue(ownership),
  };
}

it('finishes an already-dispatching transfer through the existing fenced reconciliation function without sending again', async () => {
  const selected = options();
  expect(await createPrefundedCardExecution(selected)()).toEqual({
    claimed: 1,
    processed: 1,
    failed: 0,
    unacknowledged: 0,
  });
  const completion = selected.execute.mock.calls.find(([statement]) =>
    statement.includes('.complete_reconciliation(')
  );
  if (!completion) throw new Error('Expected fenced reconciliation');
  expect(completion[1].slice(0, 5)).toEqual([
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '2',
    'transfer',
    'verified_success',
  ]);
  expect(JSON.parse(completion[1][5])).toEqual({
    reference: 'pvbt-synthetic-transfer',
    amountKobo: 10000,
    currency: 'NGN',
    businessId: 'business_1',
    sourceWalletId: 'wallet_source',
    destinationWalletId: 'wallet_destination',
    destinationCustomerId: 'customer_destination',
    providerTransactionId: 'PVBsynthetic-transfer-id',
  });
  for (const [, init] of selected.fetchImplementation.mock.calls)
    expect(init.method).toBe('GET');
  expect(
    selected.execute.mock.calls.some(([statement]) =>
      /claim_transfer|record_transfer|reserve|GRANT/.test(statement)
    )
  ).toBe(false);
});

it('keeps production composition fail-closed when no ownership resolver is wired', async () => {
  const { resolveTransferOwnership, ...selected } = options();
  await createPrefundedCardExecution(selected)();
  expect(
    selected.execute.mock.calls.some(([statement]) =>
      statement.includes('.complete_reconciliation(')
    )
  ).toBe(false);
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
  expect(resolveTransferOwnership).not.toHaveBeenCalled();
});

it('leaves reconciliation deferred rather than substituting the expected customer when ownership is missing', async () => {
  const selected = options(null);
  expect((await createPrefundedCardExecution(selected)()).failed).toBe(0);
  expect(
    selected.execute.mock.calls.some(([statement]) =>
      statement.includes('.complete_reconciliation(')
    )
  ).toBe(false);
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
});

it('does not apply a one-time owner identity through the generic unattended worker', async () => {
  const selected = options({
    ...fixture.ownership,
    crosswalk: {
      ...fixture.ownership.crosswalk,
      authority: 'owner_reviewed_provisioning_identity',
    },
  });
  await createPrefundedCardExecution(selected)();
  expect(
    selected.execute.mock.calls.some(([statement]) =>
      statement.includes('.complete_reconciliation(')
    )
  ).toBe(false);
});
