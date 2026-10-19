import { expect, it, vi } from 'vitest';
import { createCancelPlan } from './cancel-plan';

vi.mock('server-only', () => ({}));

const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  actorId: '90000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
};
const command = {
  operationId: '80000000-0000-4000-8000-000000000001',
  actorId: configuration.actorId,
  revisionId: '70000000-0000-4000-8000-000000000001',
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  accepted: true,
  principalKobo: 100,
  paidInterestKobo: 7,
  pendingInterestKobo: 3,
};

it('quotes exact internal principal and separate interest without asserting disposition', async () => {
  const source = {
    policy: {
      revisionId: command.revisionId,
      command: {
        revisionId: command.revisionId,
        expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
        productId: '50000000-0000-4000-8000-000000000001',
        variantId: null,
        termsVersion: command.termsVersion,
        termsHash: command.termsHash,
        quoteId: 'synthetic-private',
        quoteKobo: 1000,
        quoteExpiresAt: '2099-01-01T00:00:00Z',
        guarantee: null,
        lifecycle: 'draft',
        collectionPaused: true,
      },
      device: {
        name: 'Synthetic phone',
        condition: 'new',
        variantId: null,
        variantLabel: null,
        selectionStatus: 'exact',
      },
      actorId: configuration.actorId,
      acceptedAt: '2026-09-12T01:00:00Z',
    },
    ledgerSnapshot: {
      ledger: {
        confirmedPrincipalKobo: 100,
        reservedPrincipalKobo: 0,
        paidEligibleInterestKobo: 7,
        reservedPaidInterestKobo: 0,
        pendingInterestKobo: 3,
      },
      activeReservation: null,
      fundingReversed: false,
    },
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: source }] });
  const runtime = createCancelPlan({ configuration, execute });
  expect(await runtime.quote()).toEqual({
    status: 'quote_available',
    revisionId: command.revisionId,
    termsVersion: command.termsVersion,
    termsHash: command.termsHash,
    consentVersion: command.consentVersion,
    principalKobo: 100,
    paidInterestKobo: 7,
    pendingInterestKobo: 3,
    interestDisposition: 'unresolved',
    dispatch: 'contract_gap',
  });
  source.ledgerSnapshot.fundingReversed = true;
  expect(await runtime.quote()).toEqual({ status: 'unavailable' });
  execute.mockResolvedValueOnce({
    rows: [{ result: { ...source, private: 'extra' } }],
  });
  expect(await runtime.quote()).toEqual({ status: 'unavailable' });
});

it('preserves unknown preparation outcomes and never dispatches', async () => {
  const execute = vi.fn().mockRejectedValue(new Error('synthetic-private'));
  const runtime = createCancelPlan({ configuration, execute });
  expect(await runtime.prepare(command)).toEqual({
    status: 'unavailable',
    reservation: 'may_be_retained',
    dispatch: 'contract_gap',
  });
  expect(runtime.dispatch()).toEqual({
    status: 'contract_gap',
    reason: 'provider_cancellation_mechanism_unverified',
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('requires reviewed policy mapping rather than promoting generic consent', async () => {
  const execute = vi.fn().mockResolvedValue({
    rows: [{ result: { status: 'requires_policy_specific_handling' } }],
  });
  expect(await createCancelPlan({ configuration, execute }).quote()).toEqual({
    status: 'requires_policy_specific_handling',
  });
});

it('rejects invalid local config and mismatched actor before execution', async () => {
  const execute = vi.fn();
  expect(() =>
    createCancelPlan({
      configuration: { ...configuration, transport: 'tls' },
      execute,
    })
  ).toThrow('Cancellation preparation unavailable');
  await createCancelPlan({ configuration, execute }).prepare({
    ...command,
    actorId: configuration.goalId,
  });
  expect(execute).not.toHaveBeenCalled();
});

it('accepts only the matching durable preparation receipt', async () => {
  const receipt = {
    status: 'prepared',
    operationId: command.operationId,
    collectionPaused: true,
    dispatch: 'contract_gap',
    interestDisposition: 'unresolved',
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const runtime = createCancelPlan({ configuration, execute });
  expect(await runtime.prepare(command)).toEqual(receipt);
  expect(JSON.parse(execute.mock.calls[0][1][5])).toEqual(command);
  execute.mockResolvedValueOnce({
    rows: [{ result: { ...receipt, operationId: configuration.goalId } }],
  });
  expect(await runtime.prepare(command)).toMatchObject({
    status: 'unavailable',
    reservation: 'may_be_retained',
  });
});
