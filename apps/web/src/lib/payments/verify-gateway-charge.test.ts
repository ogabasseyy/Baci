import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isTerminalGatewayVerificationReason,
  verifyGatewayCharge,
} from '@/lib/payments/verify-gateway-charge';

const mocks = vi.hoisted(() => ({
  getJuicywaySession: vi.fn(),
  verifyKorapayPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/lib/juicyway', () => ({
  getPaymentSession: mocks.getJuicywaySession,
}));
vi.mock('@/lib/korapay', () => ({
  verifyPayment: mocks.verifyKorapayPayment,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyPaystackPayment,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyGatewayCharge', () => {
  it('returns the normalized amount for a successful Paystack verification', async () => {
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: {
        amount: 12_345,
        currency: 'NGN',
        status: 'success',
      },
      success: true,
    });

    await expect(
      verifyGatewayCharge('paystack', 'successful-ref')
    ).resolves.toEqual({
      amount: 123.45,
      currency: 'NGN',
      ok: true,
      response: {
        amount: 12_345,
        currency: 'NGN',
        status: 'success',
      },
    });
  });

  it('forwards the abort signal to Paystack verification', async () => {
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: {
        amount: 12_345,
        currency: 'NGN',
        status: 'success',
      },
      success: true,
    });
    const signal = AbortSignal.timeout(1000);

    await verifyGatewayCharge('paystack', 'successful-ref', undefined, signal);

    expect(mocks.verifyPaystackPayment).toHaveBeenCalledWith(
      'successful-ref',
      signal
    );
  });

  it('forwards the abort signal to Korapay verification', async () => {
    mocks.verifyKorapayPayment.mockResolvedValue({
      data: {
        amount: 12_345,
        currency: 'NGN',
        status: 'success',
      },
      success: true,
    });
    const signal = AbortSignal.timeout(1000);

    await verifyGatewayCharge('korapay', 'successful-ref', undefined, signal);

    expect(mocks.verifyKorapayPayment).toHaveBeenCalledWith(
      'successful-ref',
      signal
    );
  });

  it.each([
    'HTTP_400',
    'HTTP_404',
  ])('classifies Paystack %s reference failures as terminal', async (code) => {
    mocks.verifyPaystackPayment.mockResolvedValue({
      code,
      error: 'Unknown transaction reference',
      success: false,
    });

    await expect(
      verifyGatewayCharge('paystack', 'missing-ref')
    ).resolves.toEqual({ ok: false, reason: 'gateway_reference_invalid' });
  });

  it.each([
    'HTTP_400',
    'HTTP_404',
  ])('classifies Korapay %s reference failures as terminal', async (code) => {
    mocks.verifyKorapayPayment.mockResolvedValue({
      code,
      error: 'Charge not found',
      success: false,
    });

    await expect(
      verifyGatewayCharge('korapay', 'missing-ref')
    ).resolves.toEqual({ ok: false, reason: 'gateway_reference_invalid' });
  });

  it('keeps gateway 5xx failures retryable', async () => {
    mocks.verifyPaystackPayment.mockResolvedValue({
      code: 'HTTP_503',
      error: 'Unavailable',
      success: false,
    });

    await expect(verifyGatewayCharge('paystack', 'retry-ref')).resolves.toEqual(
      {
        ok: false,
        reason: 'paystack_verification_unavailable',
      }
    );
  });

  it.each([
    { amount: undefined, currency: 'NGN' },
    { amount: Number.NaN, currency: 'NGN' },
    { amount: 12_345, currency: undefined },
  ])('rejects incomplete Paystack success evidence: %j', async (data) => {
    mocks.verifyPaystackPayment.mockResolvedValue({
      data: { ...data, status: 'success' },
      success: true,
    });

    await expect(
      verifyGatewayCharge('paystack', 'partial-ref')
    ).resolves.toEqual({
      ok: false,
      reason: 'paystack_verification_invalid_payload',
    });
  });

  it('rejects incomplete Korapay success evidence', async () => {
    mocks.verifyKorapayPayment.mockResolvedValue({
      data: { amount: 1000, status: 'success' },
      success: true,
    });

    await expect(
      verifyGatewayCharge('korapay', 'partial-ref')
    ).resolves.toEqual({
      ok: false,
      reason: 'korapay_verification_invalid_payload',
    });
  });

  it.each([
    'juicyway_verification_invalid_payload',
    'korapay_verification_invalid_payload',
    'paystack_verification_invalid_payload',
  ])('treats %s as a terminal review condition', (reason) => {
    expect(isTerminalGatewayVerificationReason(reason)).toBe(true);
  });
});
