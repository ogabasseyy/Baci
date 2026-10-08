import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { dispatchPrimaryCardSignedCustodyIntake } from './primary-wallet-card-custody-intake-dispatch';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-card-custody-executor', () => ({
  createPrimaryCardCustodyExecutor: () => execute,
}));
beforeEach(() => vi.clearAllMocks());
function input() {
  return {
    rawBody: fixture.rawBody,
    signature: fixture.signature,
    environment: {
      ...fixture.environment,
      PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN: undefined,
      PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: undefined,
    },
    now: () => fixture.now,
  };
}
describe('primary export webhook intake dispatcher without crosswalk delivery or financial adapter', () => {
  it('does not infer unrelated ownership when explicitly disabled but canonical scope configuration is missing', async () => {
    const result = await dispatchPrimaryCardSignedCustodyIntake({
      ...input(),
      environment: {
        ...fixture.environment,
        PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false',
        PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID: undefined,
      },
    });
    expect(result.outcome).toBe('not_ready');
    expect(result.response?.status).toBe(503);
  });
  it.each([
    'accepted',
    'duplicate',
    'conflict',
  ] as const)('acks %s only after concrete restricted storage acknowledgement', async (outcome) => {
    execute.mockResolvedValueOnce(fixture.ready).mockResolvedValueOnce(outcome);
    const result = await dispatchPrimaryCardSignedCustodyIntake(input());
    expect(result.outcome).toBe(outcome);
    expect(result.response?.status).toBe(200);
    expect(await result.response?.json()).not.toHaveProperty(
      'fundingCompleted'
    );
    expect(execute.mock.calls.map(([action]) => action)).toEqual([
      'inboxReadiness',
      'inboxEnqueue',
    ]);
  });
  it('never acknowledges not_ready when no signed bytes were committed', async () => {
    execute.mockResolvedValueOnce({ ready: false });
    const result = await dispatchPrimaryCardSignedCustodyIntake(input());
    expect(result.outcome).toBe('not_ready');
    expect(result.response?.status).toBe(503);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('never falls through on expired or incomplete configuration or storage failure', async () => {
    const unavailable = await dispatchPrimaryCardSignedCustodyIntake({
      ...input(),
      environment: {
        ...fixture.environment,
        PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: undefined,
      },
    });
    expect(unavailable.outcome).toBe('not_ready');
    expect(unavailable.response?.status).toBe(503);
    execute.mockRejectedValueOnce(new Error('private details'));
    const failed = await dispatchPrimaryCardSignedCustodyIntake(input());
    expect(failed.outcome).toBe('storage_unavailable');
    expect(failed.response?.status).toBe(503);
    expect(await failed.response?.text()).not.toContain('private details');
  });
  it('returns not_handled/null only after proving signed event belongs to another source', async () => {
    execute.mockResolvedValueOnce({
      ...fixture.ready,
      sourceWalletId: 'other-owner-source',
    });
    expect(await dispatchPrimaryCardSignedCustodyIntake(input())).toEqual({
      outcome: 'not_handled',
      response: null,
    });
  });
  it('does not allow explicit disable to lose a known primary signed receipt', async () => {
    const result = await dispatchPrimaryCardSignedCustodyIntake({
      ...input(),
      environment: {
        ...fixture.environment,
        PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false',
      },
    });
    expect(result.outcome).toBe('not_ready');
    expect(result.response?.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });
  it('returns disabled/null only for explicit disable with no owned scope or primary reference claim', async () => {
    const rawBody = Buffer.from(
      JSON.stringify({ ...fixture.envelope, customer_id: 'unrelated' })
    );
    const signature = createHmac('sha512', fixture.configuration.webhookSecret)
      .update(rawBody)
      .digest('hex');
    expect(
      await dispatchPrimaryCardSignedCustodyIntake({
        ...input(),
        rawBody,
        signature,
        environment: {
          ...fixture.environment,
          PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false',
        },
      })
    ).toEqual({ outcome: 'disabled', response: null });
  });
  it('rejects invalid signatures without a storage write or fallback', async () => {
    const result = await dispatchPrimaryCardSignedCustodyIntake({
      ...input(),
      signature: null,
    });
    expect(result.outcome).toBe('invalid_signature');
    expect(result.response?.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });
});
