import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { applyPrimaryWalletSignedPaidInterest } from './primary-wallet-paid-interest-signed';

vi.mock('server-only', () => ({}));
const involved = vi.fn();
const resolveCrosswalk = vi.fn();
const retrieveWallet = vi.fn();
const apply = vi.fn();
function signed(event: unknown = fixture.event) {
  const rawBody = Buffer.from(JSON.stringify(event));
  return {
    rawBody,
    signature: createHmac('sha512', fixture.config.webhookSecret)
      .update(rawBody)
      .digest('hex'),
    configuration: fixture.config,
    involved,
    resolveCrosswalk,
    retrieveWallet,
    apply,
    now: () => new Date('2026-10-07T20:00:01.000Z'),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  involved.mockResolvedValue(true);
  resolveCrosswalk.mockResolvedValue(fixture.crosswalk);
  retrieveWallet.mockResolvedValue(fixture.wallet);
  apply.mockResolvedValue('credited');
});
describe('signed production primary paid interest', () => {
  it('requires exact signed bytes plus an authenticated exact API/customer/business crosswalk before submitting net kobo', async () => {
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'credited'
    );
    expect(retrieveWallet).toHaveBeenCalledWith(
      'exact-api-wallet-with-hyphens'
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutId: 'provider-payout',
        crosswalkId: fixture.crosswalk.id,
        apiWalletId: fixture.wallet.data.id,
        grossKobo: 3158,
        taxKobo: 158,
        netKobo: 3000,
        amountKobo: 3000,
        currency: 'NGN',
      })
    );
    expect(apply.mock.calls[0][0]).not.toHaveProperty('principalKobo');
  });
  it.each([
    'duplicate',
    'conflict',
    'prerequisite',
  ])('preserves the atomic %s outcome', async (outcome) => {
    apply.mockResolvedValue(outcome);
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(outcome);
  });
  it('accepts a rotation-retained signature on the direct fallback path', async () => {
    const rawBody = Buffer.from(JSON.stringify(fixture.event));
    const retained = 'old-test-only-key';
    expect(
      await applyPrimaryWalletSignedPaidInterest({
        rawBody,
        signature: createHmac('sha512', retained).update(rawBody).digest('hex'),
        configuration: {
          ...fixture.config,
          retainedWebhookSecrets: [retained],
        },
        involved,
        resolveCrosswalk,
        retrieveWallet,
        apply,
        now: () => new Date('2026-10-07T20:00:01.000Z'),
      })
    ).toBe('credited');
  });
  it('fails authentication before lookup when signed bytes are changed', async () => {
    const request = signed();
    await expect(
      applyPrimaryWalletSignedPaidInterest({
        ...request,
        rawBody: Buffer.concat([request.rawBody, Buffer.from(' ')]),
      })
    ).rejects.toThrow('authentication failed');
    expect(resolveCrosswalk).not.toHaveBeenCalled();
  });
  it.each([
    null,
    '0'.repeat(128),
    'invalid',
  ])('rejects invalid signature %s before database or provider reads', async (signature) => {
    await expect(
      applyPrimaryWalletSignedPaidInterest({ ...signed(), signature })
    ).rejects.toThrow('authentication failed');
    expect(resolveCrosswalk).not.toHaveBeenCalled();
    expect(retrieveWallet).not.toHaveBeenCalled();
  });
  it('returns an explicit prerequisite without guessing a missing crosswalk or eligibility', async () => {
    resolveCrosswalk.mockResolvedValue(null);
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'prerequisite'
    );
    expect(retrieveWallet).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it('declines uninvolved legacy payouts before any crosswalk, wallet, or ledger read', async () => {
    involved.mockResolvedValue(false);
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'not_handled'
    );
    expect(resolveCrosswalk).not.toHaveBeenCalled();
    expect(retrieveWallet).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    'businessId',
    'webhookCustomerId',
    'sourceWalletId',
    'accruedWalletId',
    'destinationWalletId',
    'envelopeDestinationWalletId',
    'integrationId',
  ])('refuses a conflicting %s in the owner-approved crosswalk', async (field) => {
    resolveCrosswalk.mockResolvedValue({
      ...fixture.crosswalk,
      [field]:
        field === 'integrationId'
          ? '00000000-0000-4000-8000-000000000005'
          : 'foreign',
    });
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'prerequisite'
    );
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    'id',
    'api_customer_id',
    'business_id',
    'currency',
    'status',
  ])('does not trust an authenticated wallet whose %s conflicts', async (field) => {
    retrieveWallet.mockResolvedValue({
      ...fixture.wallet,
      data: { ...fixture.wallet.data, [field]: 'foreign' },
    });
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'prerequisite'
    );
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not infer an API customer from webhook customer when the provider omits it', async () => {
    retrieveWallet.mockResolvedValue({
      ...fixture.wallet,
      data: { ...fixture.wallet.data, api_customer_id: undefined },
    });
    expect(await applyPrimaryWalletSignedPaidInterest(signed())).toBe(
      'prerequisite'
    );
    expect(apply).not.toHaveBeenCalled();
  });
  it('rejects signed gross/tax/net inconsistency before database work', async () => {
    await expect(
      applyPrimaryWalletSignedPaidInterest(
        signed({
          ...fixture.event,
          eventData: { ...fixture.event.eventData, amount: 3158 },
        })
      )
    ).rejects.toThrow('receipt invalid');
    expect(resolveCrosswalk).not.toHaveBeenCalled();
  });
  it('rejects a foreign currency field rather than stripping it', async () => {
    await expect(
      applyPrimaryWalletSignedPaidInterest(
        signed({
          ...fixture.event,
          eventData: { ...fixture.event.eventData, currency: 'USD' },
        })
      )
    ).rejects.toThrow('receipt invalid');
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not retry uncertain writes or expose provider/storage bodies', async () => {
    apply.mockRejectedValue(new Error('private provider or database detail'));
    await expect(
      applyPrimaryWalletSignedPaidInterest(signed())
    ).rejects.toThrow('Primary paid-interest reconciliation unavailable');
    expect(apply).toHaveBeenCalledOnce();
  });
});
