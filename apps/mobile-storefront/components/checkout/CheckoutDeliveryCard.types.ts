import type { Control, FieldErrors } from 'react-hook-form';
import type { PlaceDetails } from '@/components/ui/AddressAutocomplete';
import type { SavedAddress } from '@/lib/checkout-saved-address';
import type { ShippingAddressInput } from '@/lib/validation';

export type CheckoutDeliveryCardColors = {
  background: string;
  border: string;
  card: string;
  text: string;
  textSecondary: string;
};

export type CheckoutDeliveryAddressUpdater = (value: string) => void;

export type CheckoutDeliveryCardProps = {
  colors: CheckoutDeliveryCardColors;
  control: Control<ShippingAddressInput>;
  currentDeliverySummary: string;
  defaultSavedAddress: SavedAddress | null;
  errors: FieldErrors<ShippingAddressInput>;
  hasSavedAddresses: boolean;
  isAddingNewAddress: boolean;
  isAuthenticated: boolean;
  isCollapsed: boolean;
  isDark: boolean;
  isLoadingCities: boolean;
  isLoadingLocations: boolean;
  isLoadingSavedAddresses: boolean;
  showLocationPickers: boolean;
  onAddressSelected: (
    place: PlaceDetails,
    updateAddress: CheckoutDeliveryAddressUpdater
  ) => void;
  onAddressTextChanged: (
    text: string,
    updateAddress: CheckoutDeliveryAddressUpdater
  ) => void;
  onOpenCityPicker: () => void;
  onOpenNewAddressEditor: () => void;
  onOpenStatePicker: () => void;
  onToggleCollapsed: () => void;
  onToggleSaveAsDefaultAddress: () => void;
  onUseSavedAddress: (
    savedAddress: SavedAddress,
    options?: { collapse?: boolean }
  ) => void;
  saveAsDefaultAddress: boolean;
  savedAddresses: SavedAddress[];
  selectedSavedAddress: SavedAddress | null;
  selectedSavedAddressId: string | null;
};
