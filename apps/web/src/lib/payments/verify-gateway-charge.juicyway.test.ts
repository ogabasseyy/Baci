import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyGatewayCharge } from '@/lib/payments/verify-gateway-charge';

const mocks = vi.hoisted(() => ({
  getJuicywaySession: vi.fn(),
}));

vi.mock('@/lib/juicyway', () => ({
  getPaymentSession: mocks.getJuicywaySession,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function juicywaySession(
  amount: number,
  status = 'succeeded',
  currency = 'USDT'
) {
  return {
    data: {
      id: 'session-1',
      payment: {
        amount,
        currency,
        id: 'payment-1',
        status,
      },
      status,
    },
    success: true,
  };
}

const verificationContext = {
  juicywayExpectedAmount: 50_000,
  juicywayExpectedCurrency: 'USDT',
  juicywaySessionId: 'session-1',
};

describe('verifyGatewayCharge Juicyway', () => {
  it('verifies a succeeded session against its locked settlement metadata', async () => {
    mocks.getJuicywaySession.mockResolvedValue(juicywaySession(50_000));

    await expect(
      verifyGatewayCharge('juicyway', 'BAC-JUICY', verificationContext)
    ).resolves.toEqual({
      amount: 50_000,
      currency: 'USDT',
      ok: true,
      response: juicywaySession(50_000).data,
    });
    expect(mocks.getJuicywaySession).toHaveBeenCalledWith(
      'session-1',
      undefined
    );
  });

  it('forwards the abort signal to Juicyway session lookup', async () => {
    mocks.getJuicywaySession.mockResolvedValue(juicywaySession(50_000));
    const signal = AbortSignal.timeout(1000);

    await verifyGatewayCharge(
      'juicyway',
      'BAC-JUICY',
      verificationContext,
      signal
    );

    expect(mocks.getJuicywaySession).toHaveBeenCalledWith('session-1', signal);
  });

  it('keeps a processing session pending so the next sweep retries it', async () => {
    mocks.getJuicywaySession.mockResolvedValue(
      juicywaySession(50_000, 'processing')
    );

    await expect(
      verifyGatewayCharge('juicyway', 'BAC-JUICY', verificationContext)
    ).resolves.toEqual({
      gatewayStatus: 'processing',
      ok: false,
      reason: 'juicyway_payment_pending',
    });
  });

  it('rejects an underpaid session', async () => {
    mocks.getJuicywaySession.mockResolvedValue(juicywaySession(48_000));

    await expect(
      verifyGatewayCharge('juicyway', 'BAC-JUICY', verificationContext)
    ).resolves.toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  it.each([
    { expectedResult: 'success', settledAmount: 49_500 },
    { expectedResult: 'amount_mismatch', settledAmount: 49_499 },
  ])('classifies $settledAmount at the one-percent underpayment boundary', async ({
    expectedResult,
    settledAmount,
  }) => {
    mocks.getJuicywaySession.mockResolvedValue(juicywaySession(settledAmount));

    const result = await verifyGatewayCharge(
      'juicyway',
      'BAC-JUICY',
      verificationContext
    );

    expect(result).toEqual(
      expectedResult === 'success'
        ? {
            amount: settledAmount,
            currency: 'USDT',
            ok: true,
            response: juicywaySession(settledAmount).data,
          }
        : { ok: false, reason: expectedResult }
    );
  });

  it('fails closed when reconciliation metadata is missing', async () => {
    await expect(verifyGatewayCharge('juicyway', 'BAC-JUICY')).resolves.toEqual(
      {
        ok: false,
        reason: 'juicyway_verification_context_missing',
      }
    );
    expect(mocks.getJuicywaySession).not.toHaveBeenCalled();
  });

  it('re-verifies a legacy session created before settlement metadata shipped', async () => {
    const legacyResponse = {
      data: {
        id: 'legacy-session',
        payment: {
          amount: 50_000,
          currency: 'USDT',
          id: 'legacy-payment',
          status: 'succeeded',
        },
        status: 'succeeded',
      },
      success: true,
    };
    mocks.getJuicywaySession.mockResolvedValue(legacyResponse);

    await expect(
      verifyGatewayCharge('juicyway', 'BAC-LEGACY', {
        juicywayHasExpectedSettlementMetadata: false,
        juicywaySessionId: 'legacy-session',
        juicywayTransactionCreatedAt: '2026-06-25T14:44:59.999Z',
      })
    ).resolves.toEqual({
      amount: 50_000,
      currency: 'USDT',
      ok: true,
      response: legacyResponse.data,
    });
    expect(mocks.getJuicywaySession).toHaveBeenCalledWith(
      'legacy-session',
      undefined
    );
  });

  it('requires settlement metadata for sessions created after the cutoff', async () => {
    await expect(
      verifyGatewayCharge('juicyway', 'BAC-POST-CUTOFF', {
        juicywayHasExpectedSettlementMetadata: false,
        juicywaySessionId: 'post-cutoff-session',
        juicywayTransactionCreatedAt: '2026-06-25T14:45:00.000Z',
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'juicyway_verification_context_missing',
    });
    expect(mocks.getJuicywaySession).not.toHaveBeenCalled();
  });

  it.each([
    {
      context: {
        ...verificationContext,
        juicywayTransactionCreatedAt: '2026-06-25T14:44:59.999Z',
      },
      expectedReason: 'currency_mismatch',
      response: juicywaySession(50_000, 'succeeded', 'USDC'),
    },
    {
      context: verificationContext,
      expectedReason: 'amount_mismatch',
      response: juicywaySession(48_000),
    },
  ])('enforces supplied settlement evidence when legacy context flags are absent: $expectedReason', async ({
    context,
    expectedReason,
    response,
  }) => {
    mocks.getJuicywaySession.mockResolvedValue(response);

    await expect(
      verifyGatewayCharge('juicyway', 'BAC-LEGACY-CONTEXT', context)
    ).resolves.toEqual({ ok: false, reason: expectedReason });
  });
});
