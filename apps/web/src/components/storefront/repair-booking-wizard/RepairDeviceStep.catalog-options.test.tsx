import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { z } from 'zod';
import { Form } from '@/components/ui/form';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import { RepairDeviceStep } from './RepairDeviceStep';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiGet: mocks.apiGet }));

type WizardFormValues = z.input<typeof repairBookingSchema>;

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

function Harness({
  children,
  issueDescription,
}: {
  children: (
    form: ReturnType<
      typeof useForm<WizardFormValues, unknown, RepairBookingInput>
    >
  ) => ReactNode;
  issueDescription?: string;
}) {
  const form = useForm<WizardFormValues, unknown, RepairBookingInput>({
    defaultValues: {
      customerEmail: '',
      customerName: '',
      customerPhone: '',
      deviceModel: '',
      deviceType: 'Smartphone',
      issueDescription: issueDescription ?? '',
      pickupAddress: '',
      serviceType: 'dropoff',
    },
  });

  return <Form {...form}>{children(form)}</Form>;
}

describe('RepairDeviceStep catalog behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggests phones and iPhones categories but excludes phone accessories', async () => {
    mocks.apiGet.mockResolvedValueOnce({ groups: [] }).mockResolvedValueOnce({
      products: [
        ...Array.from({ length: 8 }, (_, index) => ({
          category: 'Phone Accessories',
          id: `case-product-${index}`,
          name: `Acme Phone Case ${index}`,
        })),
        {
          category: 'Phones',
          id: 'phone-product',
          name: 'Acme Phone One',
        },
        {
          category: 'iPhones',
          id: 'iphone-product',
          name: 'Apple iPhone 15',
        },
      ],
    });

    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            catalogEnabled
            control={form.control}
            merchantId="merchant-1"
            merchantSlug="ogabassey"
            onChangeDevice={vi.fn()}
            onDeviceChange={vi.fn()}
            onSelectDevice={vi.fn()}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    fireEvent.change(screen.getByLabelText('Device Model'), {
      target: { value: 'phone' },
    });

    const modelInput = screen.getByLabelText('Device Model');
    const descriptionIds = modelInput
      .getAttribute('aria-describedby')
      ?.split(/\s+/);
    expect(
      descriptionIds?.some((descriptionId) =>
        document
          .getElementById(descriptionId)
          ?.textContent?.includes('Search repairable devices')
      )
    ).toBe(true);

    expect(
      await screen.findByRole('option', { name: 'Acme Phone One Smartphone' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Apple iPhone 15 Smartphone' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /phone case/i })
    ).not.toBeInTheDocument();
  });

  it('clears catalog linkage when the customer changes device type', async () => {
    const user = userEvent.setup();
    const onDeviceChange = vi.fn();
    const onDeviceTypeChange = vi.fn();
    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            control={form.control}
            onChangeDevice={vi.fn()}
            onDeviceChange={onDeviceChange}
            onDeviceTypeChange={onDeviceTypeChange}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    await user.click(screen.getByRole('radio', { name: 'Laptop' }));

    expect(onDeviceTypeChange).toHaveBeenCalledOnce();
    expect(onDeviceChange).not.toHaveBeenCalled();
  });

  it('uses the real store catalog when the merchant repair catalog is disabled', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockResolvedValue({
      products: [
        {
          brand: 'Apple',
          category: 'Smartphones',
          id: 'product-15',
          image: 'https://cdn.example.com/iphone-15.jpg',
          name: 'iPhone 15',
        },
      ],
    });

    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            catalogEnabled
            control={form.control}
            merchantId="merchant-1"
            merchantSlug="ogabassey"
            onChangeDevice={vi.fn()}
            onDeviceChange={vi.fn()}
            onSelectDevice={vi.fn()}
            repairCatalogEnabled={false}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 15');
    expect(
      await screen.findByRole('option', {
        name: 'Apple iPhone 15 Smartphone',
      })
    ).toBeInTheDocument();
    expect(
      mocks.apiGet.mock.calls.some(
        ([url]) =>
          url ===
          '/api/storefront/products?merchant_id=merchant-1&q=iPhone%2015&limit=50&offset=0&compact=true'
      )
    ).toBe(true);
  });

  it('keeps the catalog unavailable message when repair lookup fails and product fallback has no device', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockImplementation((url: string) =>
      url.includes('/repairs/devices')
        ? Promise.reject(new Error('repair catalog unavailable'))
        : Promise.resolve({ products: [] })
    );

    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            catalogEnabled
            control={form.control}
            merchantId="merchant-1"
            merchantSlug="ogabassey"
            onChangeDevice={vi.fn()}
            onDeviceChange={vi.fn()}
            onSelectDevice={vi.fn()}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 15');

    expect(
      await screen.findByText(
        'Catalog suggestions are unavailable. You can still enter the model.'
      )
    ).toBeInTheDocument();
  });
});
