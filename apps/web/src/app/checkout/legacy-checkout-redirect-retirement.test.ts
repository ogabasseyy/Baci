import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyCheckoutKeyInput } from './build-legacy-checkout-fingerprint';
import { clearLegacyCheckoutIdempotencyKey } from './clear-legacy-checkout-idempotency-key';
import {
  LEGACY_CHECKOUT_REDIRECT_PENDING_KEY,
  recordLegacyCheckoutRedirect,
  retireLegacyCheckoutRedirectWhenPaid,
} from './legacy-checkout-redirect-retirement';

vi.mock('./clear-legacy-checkout-idempotency-key', () => ({
  clearLegacyCheckoutIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));

const keyInput: LegacyCheckoutKeyInput = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerName: 'Buyer',
  customerPhone: '08030000000',
  gateway: 'paystack',
  shippingFee: 10,
  discountCode: 'RDM-ABC123',
  orderItems: [],
  shippingAddress: {
    firstName: 'Buyer',
    lastName: 'One',
    address: '1 Road',
    city: 'Lagos',
    state: 'Lagos',
  },
  shippingSelection: null,
} as unknown as LegacyCheckoutKeyInput;

const lookup = {
  orderId: 'order-1',
  email: 'buyer@example.com',
  merchantSlug: 'ogabassey',
};

function stubTracking(paymentStatus: string | null, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: async () => ({
        order: paymentStatus ? { payment_status: paymentStatus } : undefined,
      }),
    })
  );
}

describe('legacy checkout redirect retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('retires the retained key once the tracked order is confirmed paid', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);
    stubTracking('paid');

    await expect(retireLegacyCheckoutRedirectWhenPaid(lookup)).resolves.toBe(
      true
    );
    expect(clearLegacyCheckoutIdempotencyKey).toHaveBeenCalledWith(keyInput);
    expect(
      window.sessionStorage.getItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY)
    ).toBeNull();
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain('order_id=order-1');
    expect(url).toContain('merchant_slug=ogabassey');
  });

  it('keeps the key when the order is not paid yet (abandoned gateway)', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);
    stubTracking('pending');

    await expect(retireLegacyCheckoutRedirectWhenPaid(lookup)).resolves.toBe(
      false
    );
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY)
    ).not.toBeNull();
  });

  it('keeps the key when the tracking lookup fails', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);
    stubTracking(null, false);

    await expect(retireLegacyCheckoutRedirectWhenPaid(lookup)).resolves.toBe(
      false
    );
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
  });

  it('keeps the key when a different order is confirmed', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);
    stubTracking('paid');

    await expect(
      retireLegacyCheckoutRedirectWhenPaid({ ...lookup, orderId: 'order-2' })
    ).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
  });

  it('keeps the key when no handoff was recorded (abandoned attempt)', async () => {
    stubTracking('paid');

    await expect(retireLegacyCheckoutRedirectWhenPaid(lookup)).resolves.toBe(
      false
    );
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
  });
});
