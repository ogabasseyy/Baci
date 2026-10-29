'use client';

import { Mail, Truck, User } from 'lucide-react';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { Country as CountryCode } from 'react-phone-number-input';
import { AddressAutocomplete } from '@/components/address-autocomplete';
import { ShippingOptions } from '@/components/storefront/checkout/shipping-options';
import { ThemedInput } from '@/components/themed';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PhoneInput } from '@/components/ui/phone-input';
import { useCart } from '@/hooks/use-cart';
import { useMerchant } from '@/hooks/use-merchant-client';
import { calculateCartCatalogSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';
import { getCountryByCode } from '@/lib/countries';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import type { ShippingFormValues } from '@/schemas/checkout-shipping';
import type { ShippingQuote } from '@/types/shipping-quote';

export function CheckoutShippingStep({
  onShippingSelect,
  selectedQuote,
}: {
  onShippingSelect: (quote: ShippingQuote | null, sessionId: string) => void;
  selectedQuote: ShippingQuote | null;
}) {
  const { control, setValue } = useFormContext<ShippingFormValues>();
  const { merchant } = useMerchant();
  const { cart } = useCart();
  const [selectionRevision, setSelectionRevision] = useState(0);

  const cartSubtotal = calculateCartCatalogSubtotal(
    cart,
    hasStorefrontPriceNegotiation(merchant)
  );

  const country = merchant?.country ? getCountryByCode(merchant.country) : null;
  const isNigerian = country?.code === 'NG' || !country;

  // Use useWatch instead of watch - watch doesn't trigger re-renders in nested components!
  const watchCity = useWatch({ control, name: 'city' });
  const watchState = useWatch({ control, name: 'state' });
  const watchAddress = useWatch({ control, name: 'address' });
  const watchPhone = useWatch({ control, name: 'phone' });
  const watchFirstName = useWatch({ control, name: 'firstName' });
  const watchLastName = useWatch({ control, name: 'lastName' });
  const watchLatitude = useWatch({ control, name: 'latitude' });
  const watchLongitude = useWatch({ control, name: 'longitude' });

  const clearDestinationPin = (invalidateSelection = false) => {
    setValue('latitude', null);
    setValue('longitude', null);
    if (invalidateSelection) {
      setSelectionRevision((revision) => revision + 1);
    }
    onShippingSelect(null, '');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <FormControl>
                  <ThemedInput
                    placeholder="John"
                    {...field}
                    className="pl-10"
                    name="firstName"
                    autoComplete="given-name"
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="lastName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name (Surname)</FormLabel>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <FormControl>
                  <ThemedInput
                    placeholder="Doe"
                    {...field}
                    className="pl-10"
                    name="lastName"
                    autoComplete="family-name"
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <FormControl>
                <ThemedInput
                  type="email"
                  placeholder="you@example.com"
                  {...field}
                  className="pl-10"
                  name="shipping-email"
                  autoComplete="email"
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone Number</FormLabel>
            <FormControl>
              <PhoneInput
                placeholder="Enter phone number"
                defaultCountry={(country?.code as CountryCode) || 'NG'}
                value={field.value}
                onChange={field.onChange}
                autoComplete="tel"
                limitMaxLength={true}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Address Input - Use Nigerian autocomplete for Nigerian merchants */}
      <FormField
        control={control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Delivery Address</FormLabel>
            <FormControl>
              <AddressAutocomplete
                {...field}
                useThemedInput={true}
                showIcon={true}
                placeholder="Enter your full address"
                country={country?.code}
                selectionRevision={selectionRevision}
                onChange={(val) => {
                  clearDestinationPin();
                  field.onChange(val);
                }}
                onSelect={(place) => {
                  onShippingSelect(null, '');
                  field.onChange(place.formattedAddress);
                  setValue('city', place.city, {
                    shouldValidate: false,
                    shouldDirty: true,
                  });
                  setValue('state', place.state, {
                    shouldValidate: false,
                    shouldDirty: true,
                  });
                  setValue('latitude', place.location?.latitude ?? null);
                  setValue('longitude', place.location?.longitude ?? null);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* City and State - Auto-filled from address but editable */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <ThemedInput
                  placeholder="e.g. Ikeja, Lekki, Yaba"
                  autoComplete="new-password"
                  {...field}
                  onChange={(event) => {
                    clearDestinationPin(true);
                    field.onChange(event);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <ThemedInput
                  placeholder="e.g. Lagos"
                  autoComplete="new-password"
                  {...field}
                  onChange={(event) => {
                    clearDestinationPin(true);
                    field.onChange(event);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Shipping Options - Show when address is complete */}
      {watchCity && watchState && isNigerian && (
        <div className="pt-4 border-t">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Truck className="size-5" />
            Shipping Options
          </h3>
          <ShippingOptions
            merchantId={merchant?.id || ''}
            receiverCity={watchCity}
            receiverState={watchState}
            receiverAddress={watchAddress}
            receiverPhone={watchPhone}
            receiverName={`${watchFirstName} ${watchLastName}`}
            receiverLatitude={watchLatitude ?? undefined}
            receiverLongitude={watchLongitude ?? undefined}
            cartItems={cart.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            }))}
            cartSubtotal={cartSubtotal}
            onSelect={onShippingSelect}
            selectedQuoteId={selectedQuote?.id}
          />
        </div>
      )}
    </div>
  );
}
