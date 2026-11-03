import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createState: vi.fn(),
  decrypt: vi.fn(),
  fxRate: 1575 as number | undefined,
  loadContext: vi.fn(),
  place: vi.fn(),
}));

vi.mock('@/env', () => ({ getImeiFxNgnUsd: () => mocks.fxRate }));
vi.mock('@/lib/imei-identifier-crypto', () => ({
  decryptImeiIdentifier: mocks.decrypt,
}));
vi.mock('./petrock-remediation-order-flow', () => ({
  placePetrockRemediationOrder: mocks.place,
}));
vi.mock('./petrock-remediation-order-state', () => ({
  createPetrockRemediationOrderState: mocks.createState,
  loadPetrockRemediationOrderContext: mocks.loadContext,
}));

import { recoverPaidPetrockRemediationOrder } from './petrock-remediation-paid-recovery';

const order = {
  customer_id: 'customer-1',
  id: 'order-1',
  identifier_ciphertext: 'ciphertext',
  merchant_id: 'merchant-1',
  payment_currency: 'NGN' as const,
  remediation_product_id: 'product-1',
  status: 'paid',
};

describe('recoverPaidPetrockRemediationOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fxRate = 1575;
  });

  it('re-preflights and submits a paid row that never reached write-ahead', async () => {
    const state = { failBeforeAcceptance: vi.fn() };
    mocks.createState.mockReturnValue(state);
    mocks.decrypt.mockReturnValue('490154203237518');
    mocks.loadContext.mockResolvedValue({
      identifierCiphertext: 'ciphertext',
      identifierHash: 'a'.repeat(64),
      order: { costUsd: 75, id: 'order-1', status: 'paid' },
      product: { curatedProductId: 'product-1' },
    });
    mocks.place.mockResolvedValue({ kind: 'pending' });

    await expect(
      recoverPaidPetrockRemediationOrder({
        client: {} as never,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        order: order as never,
        origin: 'https://usebaci.com',
        supabaseAdmin: {} as never,
      })
    ).resolves.toEqual({ kind: 'pending' });
    expect(mocks.place).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: '490154203237518',
        order: expect.objectContaining({ status: 'paid' }),
      })
    );
  });

  it('refunds when a paid row cannot be recovered before any provider POST', async () => {
    const failBeforeAcceptance = vi.fn().mockResolvedValue(true);
    mocks.createState.mockReturnValue({ failBeforeAcceptance });
    mocks.loadContext.mockResolvedValue(null);

    await expect(
      recoverPaidPetrockRemediationOrder({
        client: {} as never,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        order: order as never,
        origin: 'https://usebaci.com',
        supabaseAdmin: {} as never,
      })
    ).resolves.toEqual({ kind: 'failed' });
    expect(failBeforeAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'paid_recovery_context_missing' })
    );
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it('does not report a refund when a concurrent submission defeats the refund guard', async () => {
    mocks.fxRate = undefined;
    mocks.createState.mockReturnValue({
      failBeforeAcceptance: vi.fn().mockResolvedValue(false),
    });
    expect(
      (
        await recoverPaidPetrockRemediationOrder({
          client: {} as never,
          encryptionKey: 'key',
          order: order as never,
          origin: 'https://usebaci.com',
          supabaseAdmin: {} as never,
        })
      ).kind
    ).toBe('already_started');
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it('maps a final eligibility rejection into the paid recovery refund contract', async () => {
    const failBeforeAcceptance = vi.fn().mockResolvedValue(true);
    mocks.createState.mockReturnValue({ failBeforeAcceptance });
    mocks.decrypt.mockReturnValue('490154203237518');
    mocks.loadContext.mockResolvedValue({
      identifierCiphertext: 'ciphertext',
      order: {
        status: 'paid',
        providerOrderId: null,
        providerAttemptStartedAt: null,
      },
      product: {},
    });
    mocks.place.mockResolvedValue({ kind: 'eligibility_failed' });
    expect(
      (
        await recoverPaidPetrockRemediationOrder({
          client: {} as never,
          encryptionKey: 'key',
          order: order as never,
          origin: 'https://usebaci.com',
          supabaseAdmin: {} as never,
        })
      ).kind
    ).toBe('failed');
    expect(failBeforeAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'eligibility_evidence_invalid' })
    );
  });

  it('refunds a paid row when the current FX guard is unavailable', async () => {
    const failBeforeAcceptance = vi.fn().mockResolvedValue(true);
    mocks.fxRate = undefined;
    mocks.createState.mockReturnValue({ failBeforeAcceptance });

    await expect(
      recoverPaidPetrockRemediationOrder({
        client: {} as never,
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        order: order as never,
        origin: 'https://usebaci.com',
        supabaseAdmin: {} as never,
      })
    ).resolves.toEqual({ kind: 'failed' });
    expect(failBeforeAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'paid_recovery_fx_unavailable' })
    );
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(mocks.place).not.toHaveBeenCalled();
  });
});
