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

const { mockApiGet, mockCreateRepair, mockToast } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockCreateRepair: vi.fn(),
  mockToast: vi.fn(),
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});

vi.mock('@/lib/api-client', () => ({ apiGet: mockApiGet }));
vi.mock('@/app/actions/repair', () => ({
  calculateRepairShipping: vi.fn(),
  createRepair: (...args: unknown[]) => mockCreateRepair(...args),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
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

describe('RepairBookingWizard catalog linkage', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockCreateRepair.mockReset();
    mockToast.mockReset();
  });

  it('keeps a selected suggestion closed when navigating Back to device details', async () => {
    mockApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/repairs/devices')
          ? {
              groups: [
                {
                  brand: 'Apple',
                  devices: [
                    {
                      id: '11111111-1111-4111-8111-111111111111',
                      brand: 'Apple',
                      model: 'iPhone 13 Pro Max',
                      slug: 'iphone-13-pro-max',
                      deviceType: 'Smartphone',
                    },
                  ],
                },
              ],
            }
          : { products: [] }
      )
    );
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        repairsCatalogEnabled
      />
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 13 Pro Max');
    await user.click(
      await screen.findByRole('option', {
        name: 'Apple iPhone 13 Pro Max Smartphone',
      })
    );
    await user.type(
      screen.getByLabelText("What's the issue?"),
      'The screen is damaged.'
    );
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByLabelText('Device Model')).toHaveValue(
      'Apple iPhone 13 Pro Max'
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(mockApiGet.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/repairs/devices'),
        expect.stringContaining('/api/storefront/products'),
      ])
    );
  });

  it('keeps a manually entered model when the device type changes', async () => {
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
      />
    );

    const modelField = screen.getByLabelText('Device Model');
    await user.type(modelField, 'MacBook Pro');
    await user.click(screen.getByRole('radio', { name: 'Laptop' }));

    expect(modelField).toHaveValue('MacBook Pro');
  });

  it('clears the selected catalog device and quote when device type changes', async () => {
    mockApiGet.mockResolvedValue({
      groups: [
        {
          brand: 'Apple',
          devices: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              brand: 'Apple',
              model: 'iPhone 13 Pro Max',
              slug: 'iphone-13-pro-max',
              deviceType: 'Smartphone',
            },
          ],
        },
      ],
    });
    mockCreateRepair.mockResolvedValueOnce({
      success: true,
      id: 'repair-3',
      ticketNumber: 8,
    });
    const user = userEvent.setup();
    render(
      <RepairBookingWizard
        merchantId="merchant-1"
        merchantSlug="ogabassey"
        merchantName="Ogabassey"
        repairsCatalogEnabled
      />
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 13 Pro Max');
    await user.click(
      await screen.findByRole('option', {
        name: 'Apple iPhone 13 Pro Max Smartphone',
      })
    );
    await user.click(screen.getByRole('radio', { name: 'Laptop' }));
    const modelField = screen.getByLabelText('Device Model');
    expect(modelField).toHaveValue('');
    await user.type(modelField, 'MacBook Pro');
    await user.type(
      screen.getByLabelText("What's the issue?"),
      'The screen is damaged.'
    );
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Phone Number'), '+2348012345678');
    await user.type(screen.getByLabelText('Email Address'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() => expect(mockCreateRepair).toHaveBeenCalledOnce());
    const [data] = mockCreateRepair.mock.calls[0];
    expect(data.deviceType).toBe('Laptop');
    expect(data.deviceModel).toBe('MacBook Pro');
    expect(data.deviceId).toBeUndefined();
    expect(data.quoteId).toBeUndefined();
  });
});
