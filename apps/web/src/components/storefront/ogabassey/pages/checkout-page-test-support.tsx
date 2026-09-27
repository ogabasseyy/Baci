// Register mocks before importing the production page or its dependencies.
import './checkout-page.test-fixtures';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthSafe } from '@/contexts/auth-context';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  usePersistedForm,
  usePersistedState,
} from '@/hooks/use-persisted-state';
import { toast } from '@/hooks/use-toast';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { openCredPalCheckout } from '@/lib/credpal';
import { hasPriceNegotiationEntitlement } from '@/lib/feature-flags';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import * as checkoutIdempotency from './checkout/checkout-idempotency';
import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  getCheckoutIdempotencyKey,
} from './checkout/checkout-idempotency';
import { readCreditDirectPopupMarker } from './checkout/credit-direct-popup-return';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './checkout/pending-checkout-order';
import { CheckoutPage } from './checkout-page';
import {
  addressAutocompleteMock,
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
  walletFundedTransferMock,
} from './checkout-page.test-fixtures';

function mockCheckoutSubmissionState() {
  vi.mocked(useCart).mockReturnValue({
    cart: [
      {
        id: 'item-1',
        name: 'Test Product',
        price: 5000,
        quantity: 1,
        image: '',
        slug: 'test-product',
      },
    ],
    cartTotal: 5000,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
      feature_settings: {
        pay_on_delivery_enabled: true,
      },
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedForm).mockReturnValue({
    values: {
      firstName: 'Ada',
      lastName: 'Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: '+2348123456789',
      newAddressStreet: '2 Olaide Tomori Street',
      newAddressState: 'Lagos',
      newAddressCity: 'Ikeja',
      currentStep: 'delivery',
      completedSteps: { contact: true, delivery: false },
    },
    setValue: vi.fn(),
    setValues: vi.fn(),
    clear: vi.fn(),
  } as unknown as ReturnType<typeof usePersistedForm>);
}

async function submitPickupPayOnDeliveryOrder() {
  render(<CheckoutPage />);

  fireEvent.click(screen.getByRole('button', { name: /delivery method/i }));

  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
  fireEvent.click(await screen.findByText(/pay on delivery/i));
  const placeOrderButton = screen
    .getAllByRole('button', { name: /place order/i })
    .find((button) => !button.hasAttribute('disabled'));
  expect(placeOrderButton).toBeDefined();
  fireEvent.click(placeOrderButton as HTMLButtonElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersistedForm).mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  addressAutocompleteMock.selectedPlace = null;
  vi.mocked(useRouter).mockReturnValue({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(useCart).mockReturnValue({
    cart: [],
    cartTotal: 0,
    clearCart: vi.fn(),
    isHydrated: true,
  } as unknown as ReturnType<typeof useCart>);
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
  );
  vi.mocked(useAuthSafe).mockReturnValue(
    null as unknown as ReturnType<typeof useAuthSafe>
  );
  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Test Store',
      vat_registration_status: 'registered',
      vat_rate: 7.5,
      country: 'NG',
    },
    basePath: '/ogabassey',
  } as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(usePersistedState).mockReturnValue([
    null,
    vi.fn(),
    vi.fn(),
  ] as unknown as ReturnType<typeof usePersistedState>);
});

export {
  act,
  addressAutocompleteMock,
  beforeEach,
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  CheckoutPage,
  captureCheckoutFunnelEventOnce,
  checkoutIdempotency,
  cleanup,
  describe,
  expect,
  fireEvent,
  getCheckoutIdempotencyKey,
  hasPriceNegotiationEntitlement,
  it,
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
  mockCheckoutSubmissionState,
  openCreditDirectCheckout,
  openCredPalCheckout,
  readCreditDirectPopupMarker,
  render,
  screen,
  submitPickupPayOnDeliveryOrder,
  toast,
  useAuthSafe,
  useCart,
  useMerchantSafe,
  usePersistedForm,
  usePersistedState,
  useRouter,
  useSearchParams,
  vi,
  waitFor,
  walletFundedTransferMock,
};
