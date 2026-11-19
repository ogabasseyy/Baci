import { render, screen } from '@testing-library/react';
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
}: {
  children: (
    form: ReturnType<
      typeof useForm<WizardFormValues, unknown, RepairBookingInput>
    >
  ) => ReactNode;
}) {
  const form = useForm<WizardFormValues, unknown, RepairBookingInput>({
    defaultValues: {
      customerEmail: '',
      customerName: '',
      customerPhone: '',
      deviceModel: '',
      deviceType: 'Smartphone',
      issueDescription: '',
      pickupAddress: '',
      serviceType: 'dropoff',
    },
  });

  return <Form {...form}>{children(form)}</Form>;
}

describe('RepairDeviceStep store product fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers matching published store products when no repair device is configured', async () => {
    const user = userEvent.setup();
    const onSelectDevice = vi.fn();
    mocks.apiGet.mockImplementation((url: string) =>
      url.includes('/repairs/devices')
        ? Promise.resolve({ groups: [] })
        : Promise.resolve({
            products: [
              {
                brand: 'Apple',
                category: 'Smartphones',
                id: 'product-15',
                image: 'https://cdn.example.com/iphone-15.jpg',
                name: 'iPhone 15',
              },
            ],
          })
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
    expect(
      mocks.apiGet.mock.calls.some(
        ([url]) =>
          url ===
          '/api/storefront/products?merchant_id=merchant-1&q=iPhone%2015&limit=50&offset=0&compact=true'
      )
    ).toBe(true);
  });
});
