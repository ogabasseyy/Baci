import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { RepairBookingWizard } from './RepairBookingWizard';

const OriginalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

const mocks = vi.hoisted(() => ({
  calculateRepairShipping: vi.fn(),
  createRepair: vi.fn(),
  startPickupPayment: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/app/actions/repair', () => ({
  calculateRepairShipping: mocks.calculateRepairShipping,
  createRepair: mocks.createRepair,
}));

vi.mock('@/app/actions/repair-pickup-payment', () => ({
  startCustomerRepairPickupPayment: mocks.startPickupPayment,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('framer-motion', () => {
  const stripMotionProps = <T extends object>(props: T): T => {
    const {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      transition: _transition,
      ...rest
    } = props as Record<string, unknown>;
    return rest as T;
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: {
      div: (props: ComponentProps<'div'>) => (
        <div {...stripMotionProps(props)} />
      ),
    },
  };
});

vi.mock('@/components/ui/phone-input', () => ({
  PhoneInput: ({
    defaultCountry: _defaultCountry,
    onChange,
    ...props
  }: Record<string, unknown>) => (
    <input
      {...props}
      onChange={(event: { target: { value: string } }) =>
        (onChange as (value: string) => void)?.(event.target.value)
      }
      type="tel"
    />
  ),
}));

vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: ({
    onChange,
    onSelect,
  }: {
    onChange?: (value: string) => void;
    onSelect?: (place: Record<string, unknown>) => void;
  }) => (
    <button
      onClick={() => {
        const formattedAddress = '12 Station Road, Osogbo, Osun, Nigeria';
        onChange?.(formattedAddress);
        onSelect?.({
          city: 'Osogbo',
          country: 'Nigeria',
          formattedAddress,
          route: 'Station Road',
          state: 'Osun',
          streetNumber: '12',
          zip: '',
        });
      }}
      type="button"
    >
      Use Osogbo pickup address
    </button>
  ),
}));

describe('RepairBookingWizard pickup payment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculateRepairShipping.mockResolvedValue({
      formattedPrice: '₦8,250',
      isFree: false,
      message: 'Estimated pickup fee: ₦8,250',
      price: 8250,
    });
    mocks.startPickupPayment.mockResolvedValue({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
      payment: {
        amount: 8250,
        authorizationUrl: 'https://checkout.paystack.com/access-code',
        reference: 'RPU-TEST',
      },
    });
  });

  it('creates a pickup payment and shows the secure payment action', async () => {
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="123e4567-e89b-12d3-a456-426614174000"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: '11111111-1111-4111-8111-111111111111',
          deviceLabel: 'Apple iPhone 15',
          deviceSlug: 'apple-iphone-15',
          deviceType: 'Smartphone',
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Phone Number'), '+2348012345678');
    await user.type(screen.getByLabelText('Email Address'), 'ada@example.com');
    await user.click(screen.getByText('Pickup'));
    await user.click(
      screen.getByRole('button', { name: 'Use Osogbo pickup address' })
    );

    expect(
      await screen.findByText('Estimated pickup fee: ₦8,250')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' })
    );

    await waitFor(() =>
      expect(mocks.startPickupPayment).toHaveBeenCalledOnce()
    );
    expect(mocks.startPickupPayment).toHaveBeenCalledWith(
      expect.objectContaining({ serviceType: 'pickup' }),
      8250,
      '123e4567-e89b-12d3-a456-426614174000',
      'ogabassey',
      null
    );
    expect(mocks.createRepair).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('link', { name: 'Pay securely with Paystack' })
    ).toHaveAttribute('href', 'https://checkout.paystack.com/access-code');
  });

  it('keeps the request editable when payment initialization fails', async () => {
    mocks.startPickupPayment.mockResolvedValueOnce({
      code: 'payment_initialization_failed',
      error: 'Pickup payment is temporarily unavailable.',
      success: false,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="123e4567-e89b-12d3-a456-426614174000"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: '11111111-1111-4111-8111-111111111111',
          deviceLabel: 'Apple iPhone 15',
          deviceSlug: 'apple-iphone-15',
          deviceType: 'Smartphone',
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Phone Number'), '+2348012345678');
    await user.type(screen.getByLabelText('Email Address'), 'ada@example.com');
    await user.click(screen.getByText('Pickup'));
    await user.click(
      screen.getByRole('button', { name: 'Use Osogbo pickup address' })
    );
    await screen.findByText('Estimated pickup fee: ₦8,250');
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' })
    );

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        description: 'Pickup payment is temporarily unavailable.',
        title: 'Submission Failed',
        variant: 'destructive',
      })
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
    expect(mocks.createRepair).not.toHaveBeenCalled();
  });
});
