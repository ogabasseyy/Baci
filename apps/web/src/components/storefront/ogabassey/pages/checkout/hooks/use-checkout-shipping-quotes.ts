'use client';
import { useEffect, useRef, useState } from 'react';
import { getCountryByCode } from '@/lib/countries';
import { isCheckoutDeliveryAddressReady } from '../is-checkout-delivery-address-ready';
import {
  checkoutShippingQuoteDeliveryPreference,
  shouldDiscoverCheckoutPickupQuotes,
  shouldFetchCheckoutShippingQuotes,
} from '../should-fetch-checkout-shipping-quotes';
import type { ShippingQuote } from '../types';
import { resetDeliveryQuotesForAddressChange } from '../utils';
import {
  invalidatePendingQuoteRequests,
  loadCheckoutShippingQuotes,
} from './checkout-shipping-quote-loader';
import type { CheckoutShippingQuotesOptions } from './checkout-shipping-quotes-options';

/** Own quote request state and address-triggered refresh while preserving loader race guards. */
export function useCheckoutShippingQuotes({
  isHydrated,
  merchantId,
  merchantCountry,
  checkoutCart,
  checkoutCartCatalogSubtotal,
  quoteItemsFingerprint,
  deliveryCoordinates,
  persistedSelectedQuoteId,
  persistedSelectedProviderRateId,
  currentStep,
  setCurrentStep,
  setCheckoutField,
  setCheckoutFields,
  setDeliveryMethod,
  deliveryMethod,
  newAddressStreet,
  newAddressState,
  newAddressCity,
  customerPhone,
  firstName,
  lastName,
  customerEmail,
  isNewAddressMode,
  addresses,
  selectedAddressId,
}: CheckoutShippingQuotesOptions) {
  const [shippingQuotes, setShippingQuotes] = useState<ShippingQuote[]>([]);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const selectedQuoteId = persistedSelectedQuoteId || '';
  const selectedProviderRateId = persistedSelectedProviderRateId || '';
  const setSelectedQuoteId = (id: string) => {
    setCheckoutField('selectedQuoteId', id);
    const matched = shippingQuotes.find(
      (quote) => String(quote.id) === String(id)
    );
    setCheckoutField(
      'selectedProviderRateId',
      matched?.providerRateId?.trim() || ''
    );
  };
  const [resolvedQuoteRequestKey, setResolvedQuoteRequestKey] = useState('');
  const quoteRequestSequence = useRef(0);
  const quoteAbortController = useRef<AbortController | null>(null);
  const resetQuotesForAddressChange = (options?: {
    preserveDeliveryMethod?: boolean;
  }) => {
    invalidatePendingQuoteRequests(quoteRequestSequence, quoteAbortController);
    setIsLoadingQuotes(false);
    setResolvedQuoteRequestKey('');
    resetDeliveryQuotesForAddressChange({
      setDeliveryMethod,
      setSelectedQuoteId,
      setShippingQuotes,
      clearDeliveryCoordinates: () =>
        setCheckoutFields({ deliveryCoordinates: null }),
      preserveDeliveryMethod: options?.preserveDeliveryMethod,
    });
  };
  const fetchShippingQuotes = (
    address: string,
    state: string,
    city: string,
    phone: string,
    receiverFirstName: string,
    receiverLastName: string,
    email: string,
    deliveryPreference: 'door' | 'pickup_station' = 'door',
    force = true
  ) =>
    merchantId
      ? loadCheckoutShippingQuotes(
          {
            address,
            state,
            city,
            phone,
            fName: receiverFirstName,
            lName: receiverLastName,
            email,
            merchantId: merchantId,
            deliveryPreference,
            latitude: deliveryCoordinates?.latitude,
            longitude: deliveryCoordinates?.longitude,
            countryCode: merchantCountry,
            country: getCountryByCode(merchantCountry)?.name ?? 'Nigeria',
            cartSubtotal: checkoutCartCatalogSubtotal,
          },
          checkoutCart,
          {
            activeAbortController: quoteAbortController,
            currentRequestKey: resolvedQuoteRequestKey,
            force,
            preferredSelectedQuoteId: selectedQuoteId || undefined,
            preferredProviderRateId: selectedProviderRateId || undefined,
            requestSequence: quoteRequestSequence,
            setResolvedQuoteRequestKey,
            setIsLoadingQuotes,
            setSelectedQuoteId,
            setSelectedProviderRateId: (providerRateId: string) =>
              setCheckoutField('selectedProviderRateId', providerRateId),
            setShippingQuotes,
            onPreferredQuoteMissing: () => setCurrentStep('delivery'),
            requirePreferredQuoteMatch: currentStep === 'payment',
          }
        )
      : resetQuotesForAddressChange();

  const isNewDeliveryAddressReady = isCheckoutDeliveryAddressReady({
    address: newAddressStreet,
    city: newAddressCity,
    state: newAddressState,
    country: getCountryByCode(merchantCountry)?.name ?? 'Nigeria',
  });

  // Refresh is keyed by address/cart inputs; callback identities must not trigger new quotes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: preserve input-keyed refresh semantics
  useEffect(() => {
    if (!isHydrated) return;
    if (
      deliveryMethod === 'door' ||
      deliveryMethod === 'pickup_station' ||
      deliveryMethod === 'airport'
    ) {
      if (!merchantId) {
        resetQuotesForAddressChange();
        return;
      }

      if (isNewAddressMode) {
        const hasCityState = Boolean(
          newAddressCity.trim() && newAddressState.trim()
        );
        if (
          shouldFetchCheckoutShippingQuotes({
            deliveryMethod,
            isStreetReady: isNewDeliveryAddressReady,
            hasCityState,
          }) ||
          shouldDiscoverCheckoutPickupQuotes({
            isStreetReady: isNewDeliveryAddressReady,
            hasCityState,
          })
        ) {
          fetchShippingQuotes(
            newAddressStreet,
            newAddressState,
            newAddressCity,
            customerPhone,
            firstName,
            lastName,
            customerEmail,
            checkoutShippingQuoteDeliveryPreference({
              deliveryMethod,
              isStreetReady: isNewDeliveryAddressReady,
            }),
            false
          );
        } else {
          resetQuotesForAddressChange({
            preserveDeliveryMethod:
              deliveryMethod === 'airport' ||
              deliveryMethod === 'pickup_station',
          });
        }
      } else {
        const saved = addresses.find((a) => a.id === selectedAddressId);
        if (saved) {
          const parts = saved.address.split(',').map((s) => s.trim());

          if (parts.length >= 2) {
            const stateCandidate = parts[parts.length - 1];
            const cityCandidate = parts[parts.length - 2];

            if (stateCandidate && cityCandidate) {
              fetchShippingQuotes(
                saved.address,
                stateCandidate,
                cityCandidate,
                saved.phone,
                firstName,
                lastName,
                customerEmail,
                deliveryMethod === 'pickup_station' ? 'pickup_station' : 'door',
                false
              );
            }
          }
        }
      }
    }
  }, [
    deliveryMethod,
    selectedAddressId,
    isNewAddressMode,
    isHydrated,
    isNewDeliveryAddressReady,
    newAddressStreet,
    newAddressState,
    newAddressCity,
    addresses,
    merchantId,
    quoteItemsFingerprint,
    resolvedQuoteRequestKey,
    deliveryCoordinates?.latitude,
    deliveryCoordinates?.longitude,
    checkoutCartCatalogSubtotal,
  ]);
  useEffect(
    () => () => {
      invalidatePendingQuoteRequests(
        quoteRequestSequence,
        quoteAbortController
      );
    },
    []
  );
  return {
    shippingQuotes,
    isLoadingQuotes,
    selectedQuoteId,
    setSelectedQuoteId,
    resetQuotesForAddressChange,
    fetchShippingQuotes,
    isNewDeliveryAddressReady,
  };
}
