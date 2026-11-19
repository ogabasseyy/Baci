import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), state: vi.fn() }));
vi.mock('@/env', () => ({ getImeiFxNgnUsd: () => 1575 }));
vi.mock('@/lib/imei-identifier-crypto', () => ({
  decryptImeiIdentifier: () => '490154203237518',
}));
vi.mock('./petrock-remediation-order-state', () => ({
  loadPetrockRemediationOrderContext: mocks.load,
  createPetrockRemediationOrderState: mocks.state,
}));

import { recoverPaidPetrockRemediationOrder } from './petrock-remediation-paid-recovery';

const saved = {
  customer_id: 'c1',
  merchant_id: 'm1',
  id: 'o1',
  identifier_ciphertext: 'encrypted',
  payment_currency: 'NGN',
  remediation_product_id: 'p1',
  status: 'paid',
  provider_order_id: null,
  provider_attempt_started_at: null,
};
function context(financeStatus = 'Not Eligible') {
  return {
    identifierCiphertext: 'encrypted',
    order: {
      status: 'paid',
      id: 'o1',
      eligibilityEvidence: {
        blacklistStatus: 'Clean',
        simLock: 'Locked',
        carrier: 'AT&T',
        device: 'iPhone 17 Pro Max',
        financeStatus,
      },
      providerOrderId: null,
      providerAttemptStartedAt: null,
    },
    product: {
      carrier: 'AT&T',
      curatedProductId: 'p1',
      modelScope: { kind: 'generic' },
      statusSegment: 'clean',
    },
  };
}
beforeEach(() => vi.clearAllMocks());
it.each([
  'Not Eligible',
  'Not Paid',
  'Unknown',
])('refunds a never-submitted invalid paid assessment during real recovery: %s', async (finance) => {
  const failBeforeAcceptance = vi.fn().mockResolvedValue(true);
  mocks.state.mockReturnValue({ failBeforeAcceptance });
  mocks.load.mockResolvedValue(context(finance));
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  const result = await recoverPaidPetrockRemediationOrder({
    client: client as never,
    encryptionKey: 'key',
    order: saved as never,
    origin: 'https://ogabassey.com',
    supabaseAdmin: {} as never,
  });
  expect(result.kind).toBe('failed');
  expect(failBeforeAcceptance).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'eligibility_evidence_invalid' })
  );
  expect(client.getAccount).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
});
it('preserves a fresh context that advanced to accepted submission after claim', async () => {
  const failBeforeAcceptance = vi.fn();
  mocks.state.mockReturnValue({ failBeforeAcceptance });
  const current = context();
  mocks.load.mockResolvedValue({
    ...current,
    order: {
      ...current.order,
      status: 'submitted',
      providerOrderId: 'accepted-1',
    },
  });
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  expect(
    (
      await recoverPaidPetrockRemediationOrder({
        client: client as never,
        encryptionKey: 'key',
        order: saved as never,
        origin: 'https://ogabassey.com',
        supabaseAdmin: {} as never,
      })
    ).kind
  ).toBe('already_started');
  expect(failBeforeAcceptance).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
});
it('preserves a claimed order with an indeterminate submission attempt', async () => {
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  expect(
    (
      await recoverPaidPetrockRemediationOrder({
        client: client as never,
        encryptionKey: 'key',
        order: {
          ...saved,
          provider_attempt_started_at: '2026-10-25T18:00:00Z',
        } as never,
        origin: 'https://ogabassey.com',
        supabaseAdmin: {} as never,
      })
    ).kind
  ).toBe('already_started');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.state).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
});
