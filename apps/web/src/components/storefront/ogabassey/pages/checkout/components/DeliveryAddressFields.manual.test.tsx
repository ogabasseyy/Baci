import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCheckoutAddressInference } from '../hooks/use-checkout-address-inference';
import { useCheckoutDeliveryAddressHandlers } from '../hooks/use-checkout-delivery-address-handlers';
import { isCheckoutDeliveryAddressReady } from '../is-checkout-delivery-address-ready';
import { DeliveryAddressFields } from './DeliveryAddressFields';

const emptyFields = {
  newAddressStreet: '',
  newAddressCity: '',
  newAddressState: '',
  deliveryCoordinates: null as { latitude: number; longitude: number } | null,
};
function ManualAddress({
  initialFields = emptyFields,
}: {
  initialFields?: typeof emptyFields;
}) {
  const [fields, setFields] = useState(initialFields);
  const updateFields = (updates: Partial<typeof fields>) =>
    setFields((previous) => ({ ...previous, ...updates }));
  const inference = useCheckoutAddressInference(updateFields);
  const handlers = useCheckoutDeliveryAddressHandlers({
    ...inference,
    merchantCountry: 'NG',
    newAddressCity: fields.newAddressCity,
    newAddressState: fields.newAddressState,
    resetQuotesForAddressChange: () =>
      updateFields({ deliveryCoordinates: null }),
    setFields: updateFields,
    setIsNewAddressMode: () => {},
    setNewAddressCity: (newAddressCity) => updateFields({ newAddressCity }),
    setNewAddressState: (newAddressState) => updateFields({ newAddressState }),
    setSelectedAddressId: () => {},
    shippingStates: ['Lagos', 'Ogun'],
  });
  const addressReady = isCheckoutDeliveryAddressReady({
    address: fields.newAddressStreet,
    city: fields.newAddressCity,
    state: fields.newAddressState,
    country: 'Nigeria',
  });
  return (
    <>
      <DeliveryAddressFields
        {...fields}
        {...handlers}
        signedIn={false}
        addresses={[]}
        isNewAddressMode
        selectedAddressId={null}
        merchantCountry="NG"
        shippingStates={['Lagos', 'Ogun']}
        addressReady={addressReady}
        onToggleAddressMode={() => {}}
      />
      <output aria-label="Address ready">{String(addressReady)}</output>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          error: 'Address suggestions are temporarily unavailable',
          code: 'PLACES_AUTOCOMPLETE_BUDGET_UNAVAILABLE',
        },
        { status: 503 }
      )
    )
  );
});

it('preserves manually entered locality after restoring the form and correcting its street', async () => {
  const first = render(<ManualAddress />);
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Sample Estate Ogombo' },
  });
  fireEvent.change(screen.getByLabelText('City / Town'), {
    target: { value: 'Ogombo' },
  });
  fireEvent.change(screen.getByLabelText('State'), {
    target: { value: 'Lagos' },
  });
  first.unmount();
  render(
    <ManualAddress
      initialFields={{
        ...emptyFields,
        newAddressStreet: '12 Sample Estate Ogombo',
        newAddressCity: 'Ogombo',
        newAddressState: 'Lagos',
      }}
    />
  );
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '14 Sample Estate Ogombo' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByLabelText('City / Town')).toHaveValue('Ogombo');
  expect(screen.getByLabelText('State')).toHaveValue('Lagos');
});

it('retains Geoapify attribution when editing the locality of its selected street', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        predictions: [
          {
            provider: 'geoapify',
            placeId: 'geoapify:fixture',
            mainText: '12 Sample Street',
            secondaryText: 'Ikeja, Lagos',
            fullText: '12 Sample Street, Ikeja, Lagos',
            details: {
              placeId: 'geoapify:fixture',
              formattedAddress: '12 Sample Street, Ikeja, Lagos',
              city: 'Ikeja',
              state: 'Lagos',
              country: 'Nigeria',
              location: { latitude: 6.6, longitude: 3.3 },
            },
          },
        ],
      })
    )
  );
  render(<ManualAddress />);
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Sample Street' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  fireEvent.click(screen.getByRole('button', { name: /12 Sample Street/ }));
  expect(
    screen.getAllByRole('link', { name: 'Geoapify' }).at(-1)
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('City / Town'), {
    target: { value: 'Epe' },
  });
  expect(
    screen.getAllByRole('link', { name: 'Geoapify' }).at(-1)
  ).toBeVisible();
  expect(
    screen.getAllByRole('link', { name: /OpenStreetMap/ }).at(-1)
  ).toBeVisible();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('accepts separate city and state when a natural-language street has no suggestions', async () => {
  render(<ManualAddress />);
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Sample Estate Ogombo' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(screen.getByText(/Address suggestions are unavailable/)).toBeVisible();
  expect(screen.getByLabelText('Address ready')).toHaveTextContent('false');

  fireEvent.change(screen.getByRole('textbox', { name: 'City / Town' }), {
    target: { value: 'Ogombo' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'State' }), {
    target: { value: 'Lagos' },
  });

  expect(screen.getByLabelText('Delivery Address')).toHaveValue(
    '12 Sample Estate Ogombo'
  );
  expect(screen.getByLabelText('Address ready')).toHaveTextContent('true');
});

it('keeps explicitly entered locality when correcting the street and clears it with the address', async () => {
  render(<ManualAddress />);
  fireEvent.change(screen.getByRole('textbox', { name: 'City / Town' }), {
    target: { value: 'Ogombo' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'State' }), {
    target: { value: 'Lagos' },
  });
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '14 Sample Estate Ogombo' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByLabelText('City / Town')).toHaveValue('Ogombo');
  expect(screen.getByLabelText('State')).toHaveValue('Lagos');
  expect(screen.getByLabelText('Address ready')).toHaveTextContent('true');

  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '' },
  });
  expect(screen.getByLabelText('City / Town')).toHaveValue('');
  expect(screen.getByLabelText('State')).toHaveValue('');
  expect(screen.getByLabelText('Address ready')).toHaveTextContent('false');
});

it('does not overwrite an explicit city with pending inferred address text', async () => {
  render(<ManualAddress />);
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Sample Street, Ikeja, Lagos' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'City / Town' }), {
    target: { value: 'Epe' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'State' }), {
    target: { value: 'Lagos' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByLabelText('City / Town')).toHaveValue('Epe');
  expect(screen.getByLabelText('Address ready')).toHaveTextContent('true');
});

it('discards a pending place selection after the customer edits the city', async () => {
  let completeDetails: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.startsWith('/api/places/details')) {
        return new Promise<Response>((resolve) => {
          completeDetails = resolve;
        });
      }
      return Response.json({
        predictions: [
          {
            placeId: 'fixture-place',
            mainText: '12 Sample Street',
            secondaryText: 'Ikeja, Lagos',
            fullText: '12 Sample Street, Ikeja, Lagos',
          },
        ],
      });
    })
  );
  render(<ManualAddress />);
  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Sample Street' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  fireEvent.click(screen.getByRole('button', { name: /12 Sample Street/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'City / Town' }), {
    target: { value: 'Epe' },
  });
  await act(async () =>
    completeDetails?.(
      Response.json({
        details: {
          formattedAddress: '12 Sample Street, Ikeja, Lagos',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          location: { latitude: 6.6, longitude: 3.3 },
        },
      })
    )
  );

  expect(screen.getByLabelText('City / Town')).toHaveValue('Epe');
  expect(screen.getByLabelText('Delivery Address')).toHaveValue(
    '12 Sample Street'
  );
});
