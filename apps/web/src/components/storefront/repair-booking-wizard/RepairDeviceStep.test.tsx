import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { Form } from '@/components/ui/form';
import type {
  RepairBookingInput,
  repairBookingSchema,
} from '@/lib/validations/repair';
import { RepairDeviceStep } from './RepairDeviceStep';

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

describe('RepairDeviceStep', () => {
  it('renders the free-text device form when showConfirmation is false', () => {
    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            control={form.control}
            onChangeDevice={vi.fn()}
            showConfirmation={false}
          />
        )}
      </Harness>
    );

    expect(screen.getByText(/what device needs repair/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Device Model')).toBeInTheDocument();
    expect(screen.getByLabelText("What's the issue?")).toBeInTheDocument();
  });

  it('renders the confirmation panel with device and quote details when showConfirmation is true', () => {
    render(
      <Harness issueDescription="Screen Replacement for iPhone 13.">
        {(form) => (
          <RepairDeviceStep
            control={form.control}
            onChangeDevice={vi.fn()}
            preselection={{
              deviceId: 'device-1',
              deviceLabel: 'Apple iPhone 13',
              deviceSlug: 'apple-iphone-13',
              deviceType: 'Smartphone',
              isFromPrice: true,
              quoteId: 'quote-1',
              quoteLabel: 'Screen Replacement',
              quotePrice: 25000,
            }}
            showConfirmation
          />
        )}
      </Harness>
    );

    expect(screen.getByText('Apple iPhone 13')).toBeInTheDocument();
    expect(screen.getByText('Screen Replacement')).toBeInTheDocument();
    expect(screen.getByText('From ₦25,000')).toBeInTheDocument();
    expect(screen.queryByLabelText('Device Model')).not.toBeInTheDocument();
  });

  it('calls onChangeDevice when the customer says the device is not right', async () => {
    const onChangeDevice = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            control={form.control}
            onChangeDevice={onChangeDevice}
            preselection={{
              deviceId: 'device-1',
              deviceLabel: 'Apple iPhone 13',
              deviceSlug: 'apple-iphone-13',
              deviceType: 'Smartphone',
            }}
            showConfirmation
          />
        )}
      </Harness>
    );

    await user.click(screen.getByRole('button', { name: /not this device/i }));

    expect(onChangeDevice).toHaveBeenCalledOnce();
  });

  it('omits the price line for a device-only preselection with no quote', () => {
    render(
      <Harness>
        {(form) => (
          <RepairDeviceStep
            control={form.control}
            onChangeDevice={vi.fn()}
            preselection={{
              deviceId: 'device-1',
              deviceLabel: 'Apple iPhone 13',
              deviceSlug: 'apple-iphone-13',
              deviceType: 'Smartphone',
            }}
            showConfirmation
          />
        )}
      </Harness>
    );

    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });
});
