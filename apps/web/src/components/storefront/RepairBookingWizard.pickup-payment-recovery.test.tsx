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
import {
  repairBookingWizardDefaultShippingQuote,
  repairBookingWizardMerchantId,
  repairBookingWizardPreselection,
} from './repair-booking-wizard/repair-booking-wizard.pickup-payment.fixtures';

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

async function completePickupWizard(user: ReturnType<typeof userEvent.setup>) {
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
  await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
}

describe('RepairBookingWizard pickup payment recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculateRepairShipping.mockResolvedValue(
      repairBookingWizardDefaultShippingQuote
    );
  });

  it('shows the saved ticket when payment initialization fails after booking', async () => {
    mocks.startPickupPayment.mockResolvedValueOnce({
      code: 'payment_initialization_failed',
      error:
        'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
      success: false,
      ticketNumber: 42,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId={repairBookingWizardMerchantId}
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={repairBookingWizardPreselection}
      />
    );

    await completePickupWizard(user);

    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled();
    expect(mocks.toast).toHaveBeenCalledWith({
      description:
        'Your repair request was saved, but payment could not start. Use your ticket to retry shortly. Ticket #42.',
      title: 'Submission Failed',
      variant: 'destructive',
    });
    expect(screen.queryByText('Ticket #42')).not.toBeInTheDocument();
  });

  it('updates the displayed pickup fee when the live quote changed', async () => {
    mocks.startPickupPayment.mockResolvedValueOnce({
      code: 'quote_changed',
      error: 'The pickup price changed. Review the new price before paying.',
      quote: { formattedPrice: '₦9,000', price: 9000 },
      success: false,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId={repairBookingWizardMerchantId}
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={repairBookingWizardPreselection}
      />
    );

    await completePickupWizard(user);

    expect(
      await screen.findByText('Estimated pickup fee: ₦9,000')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        description:
          'The pickup price changed. Review the new price before paying.',
        title: 'Submission Failed',
        variant: 'destructive',
      })
    );
  });
});
