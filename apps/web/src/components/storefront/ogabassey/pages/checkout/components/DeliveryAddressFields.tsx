import { Check } from 'lucide-react';
import {
  AddressAutocomplete,
  type PlaceDetails,
} from '@/components/address-autocomplete';

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
  addressReady,
  onToggleAddressMode,
  onSelectAddress,
  onStreetChange,
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
  addressReady: boolean;
  onToggleAddressMode: () => void;
  onSelectAddress: (address: SavedCheckoutAddress) => void;
  onStreetChange: (value: string) => void;
  onSelectPlace: (place: PlaceDetails) => void;
}) {
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
          {addressReady && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <Check size={12} /> Detected: {newAddressCity}, {newAddressState}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
