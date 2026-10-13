import { expect, it } from '@jest/globals';
import { isCheckoutAddressComplete } from './checkout-continue-readiness';
import { isCheckoutAddressContinueReady } from './is-checkout-address-continue-ready';

const completeAddress = {
  email: 'customer@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  address: '12 Main Street',
  city: 'Katsina',
  state: 'Katsina',
};

it('keeps the address action unavailable until every required field is valid', () => {
  expect(isCheckoutAddressComplete(completeAddress)).toBe(true);
  expect(isCheckoutAddressComplete({ ...completeAddress, email: '' })).toBe(
    false
  );
  expect(isCheckoutAddressComplete({ ...completeAddress, address: 'No' })).toBe(
    false
  );
});

it('enables Continue when a required road quote is selected and current', () => {
  expect(
    isCheckoutAddressContinueReady({
      hasContactIdentity: true,
      hasSelectedShippingQuote: true,
      isAddressComplete: true,
      isCurrentQuoteContext: true,
      isLoadingQuotes: false,
      requiresShippingQuote: true,
    })
  ).toBe(true);
});

it('keeps Continue available for free merchant pickup while provider quotes load', () => {
  expect(
    isCheckoutAddressContinueReady({
      hasContactIdentity: true,
      hasSelectedShippingQuote: false,
      isAddressComplete: true,
      isCurrentQuoteContext: false,
      isLoadingQuotes: true,
      requiresShippingQuote: false,
    })
  ).toBe(true);
});

it('keeps Continue disabled while a required quote is loading or missing', () => {
  const baseState = {
    hasContactIdentity: true,
    hasSelectedShippingQuote: true,
    isAddressComplete: true,
    isCurrentQuoteContext: false,
    requiresShippingQuote: true,
  };

  expect(
    isCheckoutAddressContinueReady({
      ...baseState,
      isLoadingQuotes: true,
    })
  ).toBe(false);
  expect(
    isCheckoutAddressContinueReady({
      ...baseState,
      isLoadingQuotes: false,
    })
  ).toBe(false);
});

it('keeps Continue disabled when pickup still has the prior door quote', () => {
  expect(
    isCheckoutAddressContinueReady({
      hasContactIdentity: true,
      hasSelectedShippingQuote: true,
      isAddressComplete: true,
      isCurrentQuoteContext: false,
      isLoadingQuotes: false,
      isPickupStation: true,
      requiresShippingQuote: true,
    })
  ).toBe(false);
});
