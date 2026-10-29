'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';
import {
  AddressAutocomplete,
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { ThemedInput } from '@/components/themed/themed-input';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';

export interface SavedCheckoutAddress {
  id: number;
  label: string;
  address: string;
  phone: string;
  isDefault: boolean;
}
export function DeliveryAddressFields({
  signedIn,
  addresses,
  isNewAddressMode,
  selectedAddressId,
  newAddressStreet,
  newAddressCity,
  newAddressState,
  merchantCountry,
  shippingStates = [],
  addressReady,
  onToggleAddressMode,
  onSelectAddress,
  onStreetChange,
  onCityChange,
  onStateChange,
  onSelectPlace,
}: {
  signedIn: boolean;
  addresses: SavedCheckoutAddress[];
  isNewAddressMode: boolean;
  selectedAddressId: number | null;
  newAddressStreet: string;
  newAddressCity: string;
  newAddressState: string;
  merchantCountry: string;
  shippingStates?: string[];
  addressReady: boolean;
  onToggleAddressMode: () => void;
  onSelectAddress: (address: SavedCheckoutAddress) => void;
  onStreetChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onStateChange: (value: string) => void;
  onSelectPlace: (place: PlaceDetails) => void;
}) {
  const [selectionRevision, setSelectionRevision] = useState(0);
  const editLocality = (change: (value: string) => void, value: string) => {
    // A pending Details response must not overwrite explicit locality edits.
    setSelectionRevision((revision) => revision + 1);
    change(value);
  };
  const states = shippingStates.length
    ? shippingStates
    : getSubdivisions(merchantCountry).map((subdivision) => subdivision.name);
  const localityInputClass =
    'w-full rounded-xl border border-store-background-text/20 bg-store-background px-4 py-3 text-sm text-store-background-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-store-primary';
  return (
    <div className="space-y-4">
      {/* Saved Addresses (for logged in users) */}
      {signedIn && addresses.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
              Where should we deliver?
            </p>
            <button
              type="button"
              onClick={() => onToggleAddressMode()}
              className="text-xs font-bold text-store-primary hover:underline"
            >
              {isNewAddressMode ? 'Select Saved Address' : '+ New Address'}
            </button>
          </div>
          {!isNewAddressMode &&
            addresses.map((addr) => (
              <label
                key={addr.id}
                className={`flex items-start p-4 rounded-xl border cursor-pointer transition-all focus-within:ring-2 focus-within:ring-store-primary focus-within:ring-offset-2 ${
                  selectedAddressId === addr.id
                    ? 'border-store-primary bg-store-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={selectedAddressId === addr.id}
                  onChange={() => onSelectAddress(addr)}
                  className="mt-1 size-4 text-store-primary focus:ring-store-primary border-gray-300"
                />
                <div className="ml-3">
                  <p className="font-bold text-gray-900 text-sm">
                    {addr.label || 'Saved Address'}
                  </p>
                  <p className="text-gray-600 text-sm mt-0.5">{addr.address}</p>
                  <p className="text-gray-500 text-xs mt-1">{addr.phone}</p>
                </div>
              </label>
            ))}
        </div>
      )}

      {/* New Address Form */}
      {(isNewAddressMode || !signedIn || addresses.length === 0) && (
        <div className="space-y-4" style={{ overflow: 'visible' }}>
          <label
            htmlFor="checkout-delivery-address"
            className="block text-xs font-bold text-gray-700 uppercase tracking-wide"
          >
            {signedIn && addresses.length > 0
              ? 'Enter New Address'
              : 'Delivery Address'}
          </label>
          <AddressAutocomplete
            selectionRevision={selectionRevision}
            id="checkout-delivery-address"
            autoComplete="street-address"
            value={newAddressStreet}
            useThemedInput={true}
            onChange={(value) =>
              onStreetChange(
                typeof value === 'string' ? value : value.target.value
              )
            }
            onSelect={onSelectPlace}
            placeholder="Start typing your address..."
            country={merchantCountry}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-hidden focus-visible:ring-0 focus:border-store-primary text-sm text-gray-900 placeholder:text-gray-400"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="checkout-delivery-city"
                className="text-sm font-medium text-store-background-text"
              >
                City / Town
              </label>
              <ThemedInput
                id="checkout-delivery-city"
                autoComplete="address-level2"
                value={newAddressCity}
                onChange={(event) =>
                  editLocality(onCityChange, event.target.value)
                }
                className={localityInputClass}
                required
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="checkout-delivery-state"
                className="text-sm font-medium text-store-background-text"
              >
                State
              </label>
              {states.length ? (
                <select
                  id="checkout-delivery-state"
                  autoComplete="address-level1"
                  value={newAddressState}
                  onChange={(event) =>
                    editLocality(onStateChange, event.target.value)
                  }
                  className={localityInputClass}
                  required
                >
                  <option value="">Select state</option>
                  {newAddressState && !states.includes(newAddressState) && (
                    <option value={newAddressState}>{newAddressState}</option>
                  )}
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              ) : (
                <ThemedInput
                  id="checkout-delivery-state"
                  autoComplete="address-level1"
                  value={newAddressState}
                  onChange={(event) =>
                    editLocality(onStateChange, event.target.value)
                  }
                  className={localityInputClass}
                  required
                />
              )}
            </div>
          </div>
          <p className="text-xs text-store-background-text/75">
            Select an address suggestion for courier delivery. Manual addresses
            show available store delivery and collection options.
          </p>
          {addressReady && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <Check size={12} /> City and state: {newAddressCity},{' '}
              {newAddressState}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
