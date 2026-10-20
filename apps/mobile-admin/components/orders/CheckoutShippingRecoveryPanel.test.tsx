import type { Order } from '@baci/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userId: 'owner',
  merchantId: 'owner',
  recovery: {
    draft: {
      address: 'Street',
      city: 'Lagos',
      state: 'Lagos',
      phone: '08012345678',
      latitude: '',
      longitude: '',
    },
    busy: false,
    confirmed: false,
    preview: null as null | {
      previewId: string | null;
      canConfirm: boolean;
      paidShippingFee: number;
      quote: {
        price: number;
        displayName: string;
        expiresAt: string;
        estimatedDays: number;
      };
    },
    error: null,
    update: vi.fn(),
    requestPreview: vi.fn(),
    confirm: vi.fn(),
  },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mocks.userId } }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'm', user_id: mocks.merchantId } }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#555',
      primary: '#00f',
      border: '#ddd',
    },
  }),
}));
vi.mock('@/hooks/orders/useCheckoutShippingRecovery', () => ({
  useCheckoutShippingRecovery: () => mocks.recovery,
}));
vi.mock('./CheckoutRecoveryAddressInput', () => ({
  CheckoutRecoveryAddressInput: ({
    onSearchChange,
  }: {
    onSearchChange: (text: string) => void;
  }) => (
    <button type="button" onClick={() => onSearchChange('New destination')}>
      Change search
    </button>
  ),
}));

import { CheckoutShippingRecoveryPanel } from './CheckoutShippingRecoveryPanel';

const order = {
  id: 'o',
  merchant_id: 'm',
  payment_status: 'paid',
  shipping_status: 'processing',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'customer_checkout',
  shipping_address: null,
} as Order;
function open() {
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Confirm destination and refresh paid quote',
    })
  );
}
describe('CheckoutShippingRecoveryPanel', () => {
  beforeEach(() => {
    mocks.userId = 'owner';
    mocks.recovery.preview = null;
    mocks.recovery.busy = false;
    mocks.recovery.confirmed = false;
    vi.clearAllMocks();
  });
  it('starts closed with no preview request, then allows explicit preview', () => {
    const blocking = vi.fn();
    render(
      <CheckoutShippingRecoveryPanel
        order={order}
        onBlockingChange={blocking}
      />
    );
    expect(mocks.recovery.requestPreview).not.toHaveBeenCalled();
    open();
    expect(blocking).toHaveBeenCalledWith(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    );
    expect(mocks.recovery.requestPreview).toHaveBeenCalledOnce();
    expect(
      screen.getByLabelText('Recovery latitude').getAttribute('value')
    ).toBe('');
  });
  it('requires destination confirmation separately from preview and booking', () => {
    mocks.recovery.preview = {
      previewId: 'p',
      canConfirm: true,
      paidShippingFee: 100,
      quote: {
        price: 100,
        displayName: 'GIG',
        expiresAt: '2099-01-01T12:00:00Z',
        estimatedDays: 2,
      },
    };
    render(
      <CheckoutShippingRecoveryPanel order={order} onBlockingChange={vi.fn()} />
    );
    open();
    const save = screen.getByRole('button', {
      name: 'Save confirmed destination and quote',
    });
    fireEvent.click(save);
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);
    expect(mocks.recovery.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('Estimated delivery: 2 days')).toBeTruthy();
    expect(
      screen.getByText(
        `Expires: ${new Date('2099-01-01T12:00:00Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Fund Wallet/)).toBeNull();
  });
  it('explains changed prices without enabling confirmation', () => {
    mocks.recovery.preview = {
      previewId: null,
      canConfirm: false,
      paidShippingFee: 100,
      quote: {
        price: 110,
        displayName: 'GIG',
        expiresAt: '2099-01-01T12:00:00Z',
        estimatedDays: 2,
      },
    };
    render(
      <CheckoutShippingRecoveryPanel order={order} onBlockingChange={vi.fn()} />
    );
    open();
    expect(screen.getByText(/differs from the paid/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('hides recovery for staff and non-checkout orders', () => {
    mocks.userId = 'staff';
    const { rerender } = render(
      <CheckoutShippingRecoveryPanel order={order} onBlockingChange={vi.fn()} />
    );
    expect(screen.queryByRole('button')).toBeNull();
    mocks.userId = 'owner';
    rerender(
      <CheckoutShippingRecoveryPanel
        order={{ ...order, shipping_funding_source: 'merchant_wallet' }}
        onBlockingChange={vi.fn()}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('clears pending pins and checkbox confirmation when the Places search changes after a preview', () => {
    mocks.recovery.preview = {
      previewId: 'p',
      canConfirm: true,
      paidShippingFee: 100,
      quote: {
        price: 100,
        displayName: 'GIG',
        expiresAt: '2099-01-01T12:00:00Z',
        estimatedDays: 2,
      },
    };
    render(
      <CheckoutShippingRecoveryPanel order={order} onBlockingChange={vi.fn()} />
    );
    open();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Change search'));
    expect(mocks.recovery.update).toHaveBeenCalledWith({
      address: 'New destination',
      city: '',
      state: '',
      countryCode: '',
      latitude: '',
      longitude: '',
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save confirmed destination and quote',
      })
    );
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
  });
});
