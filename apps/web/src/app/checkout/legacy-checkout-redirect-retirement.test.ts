import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyCheckoutKeyInput } from './build-legacy-checkout-fingerprint';
import { clearLegacyCheckoutIdempotencyKey } from './clear-legacy-checkout-idempotency-key';
import {
  LEGACY_CHECKOUT_REDIRECT_PENDING_KEY,
  recordLegacyCheckoutRedirect,
  retireLegacyCheckoutRedirectForOrder,
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

describe('legacy checkout redirect retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('retires the retained key when the confirmed order matches the handoff', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);

    await expect(retireLegacyCheckoutRedirectForOrder('order-1')).resolves.toBe(
      true
    );
    expect(clearLegacyCheckoutIdempotencyKey).toHaveBeenCalledWith(keyInput);
    expect(
      window.sessionStorage.getItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY)
    ).toBeNull();
  });

  it('keeps the key when a different order is confirmed', async () => {
    recordLegacyCheckoutRedirect('order-1', keyInput);

    await expect(retireLegacyCheckoutRedirectForOrder('order-2')).resolves.toBe(
      false
    );
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(LEGACY_CHECKOUT_REDIRECT_PENDING_KEY)
    ).not.toBeNull();
  });

  it('keeps the key when no handoff was recorded (abandoned attempt)', async () => {
    await expect(retireLegacyCheckoutRedirectForOrder('order-1')).resolves.toBe(
      false
    );
    expect(clearLegacyCheckoutIdempotencyKey).not.toHaveBeenCalled();
  });
});
