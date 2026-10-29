import type { User } from '@supabase/supabase-js';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCheckoutCustomerLifecycle } from '@/hooks/use-checkout-customer-lifecycle';
import type { GooglePlaceDetails } from '@/lib/google-places';
import type { ShippingFormValues } from '@/schemas/checkout-shipping';
import { CheckoutShippingStep } from './checkout-shipping-step';

const { predictions, details, onSelect } = vi.hoisted(() => ({
  predictions: vi.fn(),
  details: vi.fn(),
  onSelect: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ useCart: () => ({ cart: [] }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: { id: 'fixture-merchant', country: 'NG' } }),
}));
vi.mock('@/lib/google-places', () => ({
  generateSessionToken: () => crypto.randomUUID(),
  getPlacePredictions: (...args: unknown[]) => predictions(...args),
  getPlaceDetails: (...args: unknown[]) => details(...args),
}));
vi.mock('@/components/storefront/checkout/shipping-options', () => ({
  ShippingOptions: ({
    receiverLatitude,
    receiverLongitude,
  }: {
    receiverLatitude?: number;
    receiverLongitude?: number;
  }) => (
    <output aria-label="Quote destination">
      {JSON.stringify({ receiverLatitude, receiverLongitude })}
    </output>
  ),
}));

const pin = { latitude: 6.454, longitude: 3.393 };
const place: GooglePlaceDetails = {
  placeId: 'fixture-place',
  formattedAddress: '12 Broad Street, Lagos Island, Lagos',
  city: 'Lagos Island',
  state: 'Lagos',
  country: 'Nigeria',
  location: pin,
};
function Harness() {
  const form = useForm<ShippingFormValues>({
    defaultValues: {
      firstName: 'Test',
      lastName: 'Buyer',
      email: 'fixture@example.test',
      phone: '+2348031234567',
      address: '',
      city: '',
      state: '',
    },
  });
  const values = useWatch({ control: form.control });
  const lifecycle = useCheckoutCustomerLifecycle(
    null,
    form.setValue,
    form.getValues
  );
  return (
    <FormProvider {...form}>
      <CheckoutShippingStep
        key={lifecycle.addressRevision}
        selectedQuote={null}
        onShippingSelect={onSelect}
      />
      <button
        type="button"
        onClick={() =>
          lifecycle.handleAuthSuccess(
            { id: 'fixture-user', email: 'fixture@example.test' } as User,
            {
              email: 'fixture@example.test',
              saved_addresses: [
                {
                  first_name: 'Test',
                  last_name: 'Buyer',
                  phone: '+2348031234567',
                  address: '12 Broad Street',
                  city: 'Ikeja',
                  state: 'Lagos',
                  is_default: true,
                },
              ],
            }
          )
        }
      >
        Load saved address
      </button>
      <output aria-label="Form destination">{JSON.stringify(values)}</output>
    </FormProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  predictions.mockResolvedValue([
    {
      placeId: 'fixture-place',
      mainText: '12 Broad Street',
      secondaryText: 'Lagos Island, Lagos',
      fullText: place.formattedAddress,
    },
  ]);
  details.mockResolvedValue(place);
});
it('keeps typing predictions and async Details active, then clears the pin on locality edits', async () => {
  render(<Harness />);
  for (const name of [
    'First Name',
    'Last Name (Surname)',
    'Email',
    'Phone Number',
  ]) {
    expect(screen.getByRole('textbox', { name })).toBeVisible();
  }
  fireEvent.change(screen.getByRole('textbox', { name: 'Delivery Address' }), {
    target: { value: '12 Broad' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /12 Broad Street.*Lagos Island/ })
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Quote destination')).toHaveTextContent(
      '6.454'
    )
  );
  expect(screen.getByLabelText('Quote destination')).toHaveTextContent('3.393');
  expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue(
    'Lagos Island'
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
    target: { value: 'Ikeja' },
  });
  expect(screen.getByLabelText('Form destination')).toHaveTextContent(
    '"latitude":null'
  );
  expect(screen.getByLabelText('Quote destination')).not.toHaveTextContent(
    '6.454'
  );
  expect(onSelect).toHaveBeenLastCalledWith(null, '');
});
it('does not restore an old pin when Details completes after a state edit', async () => {
  let finish!: (value: GooglePlaceDetails) => void;
  details.mockReturnValue(
    new Promise<GooglePlaceDetails>((resolve) => {
      finish = resolve;
    })
  );
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Delivery Address' }), {
    target: { value: '12 Broad' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /12 Broad Street.*Lagos Island/ })
  );
  await waitFor(() => expect(details).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox', { name: 'State' }), {
    target: { value: 'Ogun' },
  });
  await act(async () => finish(place));
  expect(screen.getByRole('textbox', { name: 'State' })).toHaveValue('Ogun');
  expect(screen.getByLabelText('Form destination')).toHaveTextContent(
    '"latitude":null'
  );
});

it('ignores pending Details after saved-address prefill replaces the locality', async () => {
  let finish!: (value: GooglePlaceDetails) => void;
  details.mockReturnValue(
    new Promise<GooglePlaceDetails>((resolve) => {
      finish = resolve;
    })
  );
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Delivery Address' }), {
    target: { value: '12 Broad' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /12 Broad Street.*Lagos Island/ })
  );
  await waitFor(() => expect(details).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Load saved address' }));
  await act(async () => finish(place));
  expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Ikeja');
  expect(screen.getByLabelText('Form destination')).toHaveTextContent(
    '"latitude":null'
  );
});
