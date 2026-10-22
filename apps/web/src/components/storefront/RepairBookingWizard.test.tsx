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

// RadioGroupItem (device type / service type selectors) uses Radix's
// useSize internally, which needs ResizeObserver — not implemented in jsdom.
const OriginalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      // intentional noop
    }
    unobserve() {
      // intentional noop
    }
    disconnect() {
      // intentional noop
    }
  };
});

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

const { mockCreateRepair, mockToast, mockMotionInitialValues } = vi.hoisted(
  () => ({
    mockCreateRepair: vi.fn(),
    mockToast: vi.fn(),
    mockMotionInitialValues: [] as unknown[],
  })
);

vi.mock('@/app/actions/repair', () => ({
  calculateRepairShipping: vi.fn(),
  createRepair: (...args: unknown[]) => mockCreateRepair(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('framer-motion', () => {
  const stripMotionProps = <T extends object>(props: T): T => {
    const propsRecord = props as Record<string, unknown>;
    const {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      transition: _transition,
      ...rest
    } = propsRecord;
    mockMotionInitialValues.push(_initial);
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

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/phone-input', () => ({
  PhoneInput: (props: Record<string, unknown>) => (
    <input
      {...props}
      onChange={(event: { target: { value: string } }) =>
        (props.onChange as (value: string) => void)?.(event.target.value)
      }
      type="tel"
    />
  ),
}));

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';

async function fillContactStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Phone Number'), '+2348012345678');
  await user.type(screen.getByLabelText('Email Address'), 'ada@example.com');
}

describe('RepairBookingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMotionInitialValues.length = 0;
  });

  it('renders the free-text device form by default (no preselection)', () => {
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
      />
    );

    expect(screen.getByText(/what device needs repair/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Device Model')).toBeInTheDocument();
    expect(mockMotionInitialValues).toContain(false);
  });

  it('shows a confirmation panel with the device and quoted price when preselected', () => {
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: DEVICE_ID,
          deviceLabel: 'Apple iPhone 13 Pro Max',
          deviceSlug: 'apple-iphone-13-pro-max',
          deviceType: 'Smartphone',
          quoteId: QUOTE_ID,
          quoteLabel: 'Screen Replacement',
          quotePrice: 25000,
          isFromPrice: true,
        }}
      />
    );

    expect(screen.getByText('Apple iPhone 13 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('Screen Replacement')).toBeInTheDocument();
    expect(screen.getByText(/25,000/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Device Model')).not.toBeInTheDocument();
  });

  it('falls back to the free-text form when the user says the device is not right', async () => {
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: DEVICE_ID,
          deviceLabel: 'Apple iPhone 13 Pro Max',
          deviceSlug: 'apple-iphone-13-pro-max',
          deviceType: 'Smartphone',
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /not this device/i }));

    expect(screen.getByLabelText('Device Model')).toBeInTheDocument();
    expect(
      screen.queryByText('Apple iPhone 13 Pro Max')
    ).not.toBeInTheDocument();
  });

  it('submits deviceId and quoteId through to createRepair when a catalogue quote was preselected', async () => {
    mockCreateRepair.mockResolvedValueOnce({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: DEVICE_ID,
          deviceLabel: 'Apple iPhone 13 Pro Max',
          deviceSlug: 'apple-iphone-13-pro-max',
          deviceType: 'Smartphone',
          quoteId: QUOTE_ID,
          quoteLabel: 'Screen Replacement',
          quotePrice: 25000,
          isFromPrice: true,
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await fillContactStep(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() => expect(mockCreateRepair).toHaveBeenCalledOnce());
    const [data, merchantId] = mockCreateRepair.mock.calls[0];
    expect(merchantId).toBe('merchant-1');
    expect(data.deviceId).toBe(DEVICE_ID);
    expect(data.quoteId).toBe(QUOTE_ID);
    expect(data.deviceModel).toBe('Apple iPhone 13 Pro Max');

    await waitFor(() =>
      expect(screen.getByText('Ticket #42')).toBeInTheDocument()
    );
  });

  it('omits deviceId and quoteId when no device was preselected (free-text path)', async () => {
    mockCreateRepair.mockResolvedValueOnce({
      success: true,
      id: 'repair-2',
      ticketNumber: 7,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
      />
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 13 Pro Max');
    await user.type(
      screen.getByLabelText("What's the issue?"),
      'Screen is cracked and unresponsive in the corner.'
    );
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await fillContactStep(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() => expect(mockCreateRepair).toHaveBeenCalledOnce());
    const [data] = mockCreateRepair.mock.calls[0];
    expect(data.deviceId).toBeUndefined();
    expect(data.quoteId).toBeUndefined();
  });

  it('shows a friendly toast when the RPC rejects a stale quote', async () => {
    mockCreateRepair.mockResolvedValueOnce({
      success: false,
      error: 'That repair option is no longer available. Please pick another.',
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        preselection={{
          deviceId: DEVICE_ID,
          deviceLabel: 'Apple iPhone 13 Pro Max',
          deviceSlug: 'apple-iphone-13-pro-max',
          deviceType: 'Smartphone',
          quoteId: QUOTE_ID,
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await fillContactStep(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description:
            'That repair option is no longer available. Please pick another.',
        })
      )
    );
  });
});
