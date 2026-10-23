import { render, screen, waitFor } from '@testing-library/react';
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
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);
const scrollIntoView = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
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
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
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

  it('shows keyboard-selectable catalog device buttons and selects the merchant device record', async () => {
    const user = userEvent.setup();
    const onSelectDevice = vi.fn();
    const device = {
      brand: 'Apple',
      deviceType: 'Smartphone' as const,
      id: '11111111-1111-4111-8111-111111111111',
      imageUrl: 'https://cdn.example.com/iphone-15.jpg',
      model: 'iPhone 15',
      productId: null,
      slug: 'apple-iphone-15',
    };
    mocks.apiGet.mockResolvedValue({
      groups: [{ brand: 'Apple', devices: [device] }],
    });

    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            catalogEnabled
            control={form.control}
            merchantSlug="ogabassey"
            onChangeDevice={vi.fn()}
            onDeviceChange={vi.fn()}
            onSelectDevice={(selectedDevice) => {
              onSelectDevice(selectedDevice);
              form.setValue(
                'deviceModel',
                'kind' in selectedDevice
                  ? selectedDevice.displayName
                  : `${selectedDevice.brand} ${selectedDevice.model}`.trim()
              );
            }}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    const input = screen.getByRole('combobox', { name: 'Device Model' });
    await user.type(input, 'iPhone 15');
    await waitFor(() =>
      expect(mocks.apiGet).toHaveBeenLastCalledWith(
        '/api/storefront/ogabassey/repairs/devices?q=iPhone%2015',
        expect.anything()
      )
    );
    const suggestion = await screen.findByRole('option', {
      name: 'Apple iPhone 15 Smartphone',
    });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'repair-device-suggestions');
    expect(
      screen.getByRole('img', { name: 'Apple iPhone 15' })
    ).toHaveAttribute('src', expect.stringContaining('iphone-15.jpg'));
    expect(screen.getByRole('listbox')).toContainElement(suggestion);
    await user.keyboard('{ArrowDown}');
    expect(suggestion).toHaveClass('border-primary/50', 'bg-accent');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(mocks.apiGet).toHaveBeenCalledWith(
        '/api/storefront/ogabassey/repairs/devices?q=iPhone%2015',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    expect(onSelectDevice).toHaveBeenCalledWith(device);
    expect(screen.getByLabelText('Device Model')).toHaveValue(
      'Apple iPhone 15'
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: /apple iphone 15/i })
      ).not.toBeInTheDocument()
    );
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('falls back to matching published store products when no repair device is configured', async () => {
    const user = userEvent.setup();
    const onSelectDevice = vi.fn();
    mocks.apiGet.mockResolvedValueOnce({ groups: [] }).mockResolvedValueOnce({
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
            onSelectDevice={(device) => {
              onSelectDevice(device);
              if ('kind' in device) {
                form.setValue('deviceModel', device.displayName);
              }
            }}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    await user.type(screen.getByLabelText('Device Model'), 'iPhone 15');
    const suggestion = await screen.findByRole('option', {
      name: 'Apple iPhone 15 Smartphone',
    });
    expect(
      screen.getByRole('img', { name: 'Apple iPhone 15' })
    ).toHaveAttribute('src', expect.stringContaining('iphone-15.jpg'));
    await user.click(suggestion);

    expect(onSelectDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'store-product',
        productId: 'product-15',
        deviceType: 'Smartphone',
      })
    );
    expect(screen.getByLabelText('Device Model')).toHaveValue(
      'Apple iPhone 15'
    );
    expect(mocks.apiGet).toHaveBeenNthCalledWith(
      2,
      '/api/storefront/products?merchant_id=merchant-1&q=iPhone%2015&limit=50&compact=true',
      expect.anything()
    );
  });
});
