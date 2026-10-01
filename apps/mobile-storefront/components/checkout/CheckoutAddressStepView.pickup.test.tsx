import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import { CheckoutAddressStepView } from './CheckoutAddressStepView';
import { MERCHANT_PICKUP_QUOTE_ID } from './merchant-pickup-location';
import type { ShippingQuote } from './types';

const mockPickupLocationOptions = jest.fn();
const mockShippingQuotesCard = jest.fn();

jest.mock('@/components/checkout/CheckoutContactCard', () => ({
  CheckoutContactCard: () => null,
}));
jest.mock('@/components/checkout/CheckoutDeliveryCard', () => ({
  CheckoutDeliveryCard: () => null,
}));
jest.mock('@/components/checkout/CheckoutFormField', () => ({
  CheckoutFormField: () => null,
}));
jest.mock('@/components/checkout/DeliveryMethodCard', () => ({
  DeliveryMethodCard: ({ children }: { children?: ReactNode }) => {
    const { Text, View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View>
        <Text>delivery method card</Text>
        {children}
      </View>
    );
  },
}));
jest.mock('@/components/checkout/DeliveryNotesCard', () => ({
  DeliveryNotesCard: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/checkout/PickupStationCard', () => ({
  PickupStationCard: () => null,
}));
jest.mock('@/components/checkout/PickupLocationOptions', () => ({
  PickupLocationOptions: (props: Record<string, unknown>) => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    mockPickupLocationOptions(props);
    return <Text>pickup location options</Text>;
  },
}));
jest.mock('@/components/checkout/ShippingQuotesCard', () => ({
  ShippingQuotesCard: (props: Record<string, unknown>) => {
    mockShippingQuotesCard(props);
    return null;
  },
}));

type AddressStepProps = ComponentProps<typeof CheckoutAddressStepView>;

const merchantPickupLocation = {
  address: '2 Olaide Tomori St, Ikeja, Lagos',
  city: 'Ikeja',
  label: 'OgaBassey Office',
  state: 'Lagos',
};
const stationQuote: ShippingQuote = {
  displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
  id: 'station-quote',
  isStationPickup: true,
  price: 9493,
  provider: 'GIGL',
  stationAddress: 'GIGL Aba Road, Port Harcourt',
  stationName: 'PORT HARCOURT',
};
const doorQuote: ShippingQuote = {
  displayName: 'GIG Logistics - GoStandard',
  id: 'door-quote',
  price: 10_000,
  provider: 'GIGL',
};
const goFasterQuote: ShippingQuote = {
  displayName: 'GIG Logistics - GoFaster',
  id: 'gofaster-quote',
  price: 18_500,
  provider: 'GIGL',
  serviceTier: 'GoFaster',
};

function createProps(
  overrides: Partial<AddressStepProps> = {}
): AddressStepProps {
  return {
    accountPassword: '',
    colors: {
      background: '#ffffff',
      border: '#e5e7eb',
      card: '#ffffff',
      text: '#111827',
      textSecondary: '#6b7280',
    } as unknown as AddressStepProps['colors'],
    contactSummary: 'Ada Lovelace',
    control: {} as AddressStepProps['control'],
    currentDeliverySummary: '5 Customer Street',
    defaultSavedAddress: null,
    deliveryMethod: 'pickup_station',
    errors: {},
    formContentPaddingBottom: 32,
    hasContactIdentity: true,
    hasSavedAddresses: false,
    isAddingNewAddress: false,
    isAuthenticated: true,
    isContactCollapsed: true,
    isDark: false,
    isDeliveryCollapsed: false,
    isLoadingCities: false,
    isLoadingLocations: false,
    isLoadingQuotes: false,
    isLoadingSavedAddresses: false,
    showLocationPickers: true,
    merchantPickupLocation,
    onAddressSelected: jest.fn() as AddressStepProps['onAddressSelected'],
    onAddressTextChanged: jest.fn() as AddressStepProps['onAddressTextChanged'],
    onChangeAccountPassword: jest.fn(),
    onContactEmailSettled: jest.fn(),
    onOpenCityPicker: jest.fn(),
    onOpenNewAddressEditor: jest.fn(),
    onOpenStatePicker: jest.fn(),
    onRetryQuotes: jest.fn(),
    onSelectDeliveryMethod: jest.fn(),
    onSelectQuote: jest.fn(),
    onToggleContactCollapsed: jest.fn(),
    onToggleDeliveryCollapsed: jest.fn(),
    onToggleSaveAsDefaultAddress: jest.fn(),
    onToggleSaveDetails: jest.fn(),
    onUseSavedAddress: jest.fn() as AddressStepProps['onUseSavedAddress'],
    phone: '08012345678',
    saveAsDefaultAddress: false,
    saveDetails: false,
    savedAddresses: [],
    selectedQuote: undefined,
    selectedQuoteId: '',
    selectedSavedAddress: null,
    selectedSavedAddressId: null,
    shippingQuotes: [],
    watchedCity: 'Ikeja',
    watchedEmail: 'ada@example.com',
    watchedState: 'Lagos',
    ...overrides,
  };
}

describe('CheckoutAddressStepView pickup options', () => {
  beforeEach(() => {
    mockPickupLocationOptions.mockClear();
    mockShippingQuotesCard.mockClear();
  });

  it('keeps station-pickup quotes out of the door delivery selector', () => {
    render(
      <CheckoutAddressStepView
        {...createProps({
          deliveryMethod: 'door',
          selectedQuote: stationQuote,
          selectedQuoteId: String(stationQuote.id),
          shippingQuotes: [doorQuote, stationQuote],
        })}
      />
    );

    const quotesProps = mockShippingQuotesCard.mock.calls[0]?.[0] as {
      shippingQuotes: ShippingQuote[];
      stationPickupQuote?: ShippingQuote;
    };
    expect(quotesProps.shippingQuotes).toEqual([doorQuote]);
    expect(quotesProps.stationPickupQuote).toBe(stationQuote);
  });

  it('shows GoStandard under Road and GoFaster beside the local Air option', () => {
    const { rerender } = render(
      <CheckoutAddressStepView
        {...createProps({
          deliveryMethod: 'door',
          selectedQuote: doorQuote,
          selectedQuoteId: String(doorQuote.id),
          shippingQuotes: [doorQuote, goFasterQuote],
        })}
      />
    );

    let quotesProps = mockShippingQuotesCard.mock.calls.at(-1)?.[0] as {
      shippingQuotes: ShippingQuote[];
    };
    expect(quotesProps.shippingQuotes).toEqual([doorQuote]);

    rerender(
      <CheckoutAddressStepView
        {...createProps({
          deliveryMethod: 'airport',
          selectedQuote: goFasterQuote,
          selectedQuoteId: String(goFasterQuote.id),
          watchedCity: 'Port Harcourt',
          watchedState: 'Rivers',
          shippingQuotes: [
            doorQuote,
            goFasterQuote,
            {
              ...goFasterQuote,
              id: 'station-gofaster-quote',
              isStationPickup: true,
            },
          ],
        })}
      />
    );

    quotesProps = mockShippingQuotesCard.mock.calls.at(-1)?.[0] as {
      shippingQuotes: ShippingQuote[];
    };
    expect(quotesProps.shippingQuotes.map((quote) => quote.id)).toEqual([
      'airport-delivery',
      'gofaster-quote',
    ]);
  });

  it('passes provider quotes without a pickup estimate', () => {
    render(
      <CheckoutAddressStepView
        {...createProps({
          merchantPickupLocation: undefined,
          selectedQuote: stationQuote,
          selectedQuoteId: String(stationQuote.id),
          shippingQuotes: [stationQuote],
          watchedCity: 'Port Harcourt',
          watchedState: 'Rivers',
        })}
      />
    );

    expect(mockPickupLocationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        providerQuotes: [stationQuote],
        selectedQuoteId: stationQuote.id,
      })
    );
    expect(mockShippingQuotesCard).not.toHaveBeenCalled();
  });

  it('keeps provider-only pickup unselected when no quote is selected', () => {
    render(
      <CheckoutAddressStepView
        {...createProps({
          merchantPickupLocation: undefined,
          shippingQuotes: [stationQuote],
          watchedCity: 'Port Harcourt',
          watchedState: 'Rivers',
        })}
      />
    );

    expect(mockPickupLocationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ selectedQuoteId: '' })
    );
  });

  it('falls back to the merchant pickup selection when no quote is selected', () => {
    render(<CheckoutAddressStepView {...createProps()} />);

    expect(mockPickupLocationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantLocation: merchantPickupLocation,
        selectedQuoteId: MERCHANT_PICKUP_QUOTE_ID,
      })
    );
  });

  it('renders provider quote selection for non-Lagos pickup stations', () => {
    const screen = render(
      <CheckoutAddressStepView
        {...createProps({
          merchantPickupLocation: undefined,
          watchedCity: 'Port Harcourt',
          watchedState: 'Rivers',
        })}
      />
    );

    expect(screen.getByText('pickup location options')).toBeTruthy();
    expect(mockPickupLocationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ providerQuotes: [] })
    );
  });

  it('keeps Lagos free pickup inside the delivery methods card', () => {
    const screen = render(<CheckoutAddressStepView {...createProps()} />);

    expect(screen.getByText('delivery method card')).toBeTruthy();
    expect(mockShippingQuotesCard).not.toHaveBeenCalled();
    expect(mockPickupLocationOptions).toHaveBeenCalled();
  });
});
