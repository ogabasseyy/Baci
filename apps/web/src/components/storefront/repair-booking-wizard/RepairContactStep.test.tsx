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
import { RepairContactStep } from './RepairContactStep';

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

vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: (props: Record<string, unknown>) => (
    <input
      aria-describedby={props['aria-describedby'] as string | undefined}
      aria-invalid={props['aria-invalid'] as boolean | undefined}
      aria-label="Pickup Address"
      id={props.id as string | undefined}
      onChange={(event: { target: { value: string } }) =>
        (props.onChange as (value: string) => void)?.(event.target.value)
      }
      value={props.value as string}
    />
  ),
}));

function Harness({
  children,
  serviceType,
}: {
  children: (
    form: ReturnType<
      typeof useForm<WizardFormValues, unknown, RepairBookingInput>
    >
  ) => ReactNode;
  serviceType?: 'dropoff' | 'pickup';
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
      serviceType: serviceType ?? 'dropoff',
    },
  });

  return <Form {...form}>{children(form)}</Form>;
}

describe('RepairContactStep', () => {
  it('renders contact fields and the drop-off/pickup choice', () => {
    render(
      <Harness>
        {(form) => (
          <RepairContactStep
            control={form.control}
            isCalculatingShipping={false}
            onAddressSelect={vi.fn()}
            serviceType="dropoff"
            shippingQuote={null}
          />
        )}
      </Harness>
    );

    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /drop-off/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /pickup/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Pickup Address')).not.toBeInTheDocument();
  });

  it('associates pickup guidance and validation errors with the address input', async () => {
    const user = userEvent.setup();
    render(
      <Harness serviceType="pickup">
        {(form) => (
          <>
            <RepairContactStep
              control={form.control}
              isCalculatingShipping={false}
              onAddressSelect={vi.fn()}
              serviceType="pickup"
              shippingQuote={null}
            />
            <button
              onClick={() =>
                form.setError('pickupAddress', {
                  message: 'Choose an address suggestion',
                })
              }
              type="button"
            >
              Show address error
            </button>
          </>
        )}
      </Harness>
    );

    await user.click(
      screen.getByRole('button', { name: 'Show address error' })
    );

    const address = screen.getByLabelText('Pickup Address');
    const describedBy = address.getAttribute('aria-describedby')?.split(' ');
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy?.[0] ?? '')).toHaveTextContent(
      /select an address suggestion to calculate the gig logistics pickup fee/i
    );
    expect(document.getElementById(describedBy?.[1] ?? '')).toHaveTextContent(
      'Choose an address suggestion'
    );
  });

  it('shows the pickup address field and shipping quote when service type is pickup', () => {
    render(
      <Harness serviceType="pickup">
        {(form) => (
          <RepairContactStep
            control={form.control}
            isCalculatingShipping={false}
            onAddressSelect={vi.fn()}
            serviceType="pickup"
            shippingQuote={{
              formattedPrice: 'Free',
              isFree: true,
              price: 0,
              message: 'Free pickup available in Lagos!',
            }}
          />
        )}
      </Harness>
    );

    expect(screen.getByLabelText('Pickup Address')).toBeInTheDocument();
    expect(
      screen.getByText(
        /select an address suggestion to calculate the GIG Logistics pickup fee/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Free pickup available in Lagos!')
    ).toBeInTheDocument();
  });

  it('shows a calculating indicator while the shipping quote loads', () => {
    render(
      <Harness serviceType="pickup">
        {(form) => (
          <RepairContactStep
            control={form.control}
            isCalculatingShipping
            onAddressSelect={vi.fn()}
            serviceType="pickup"
            shippingQuote={null}
          />
        )}
      </Harness>
    );

    expect(screen.getByText(/calculating pickup fee/i)).toBeInTheDocument();
  });

  it('lets the customer type their name', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(form) => (
          <RepairContactStep
            control={form.control}
            isCalculatingShipping={false}
            onAddressSelect={vi.fn()}
            serviceType="dropoff"
            shippingQuote={null}
          />
        )}
      </Harness>
    );

    const nameInput = screen.getByLabelText('Full Name');
    await user.type(nameInput, 'Ada Lovelace');

    expect(nameInput).toHaveValue('Ada Lovelace');
  });
});
