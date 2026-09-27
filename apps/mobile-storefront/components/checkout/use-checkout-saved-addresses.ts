import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import {
  getDefaultSavedAddress,
  type SavedAddress,
  toCheckoutAddressValues,
} from '@/lib/checkout-saved-address';
import { fetchCheckoutSavedAddresses } from '@/lib/fetch-checkout-saved-addresses';
import type { ShippingAddressInput } from '@/lib/validation';

interface UseCheckoutSavedAddressesParams {
  customerId?: string;
  hasInitialContactIdentity: boolean;
  isAuthenticated: boolean;
  merchantId: string;
  setCommittedAddress: (value: string) => void;
  setValue: UseFormSetValue<ShippingAddressInput>;
  /**
   * Settles contact to explicitly applied values. A saved address hydration
   * is a deliberate selection whose recipient can differ from the account
   * identity; without settling, prefilled checkout stays stuck with nothing
   * left for the user to do.
   */
  settleContactTo?: (values: {
    firstName: string;
    lastName: string;
    phone: string;
  }) => void;
}

export function useCheckoutSavedAddresses({
  customerId,
  hasInitialContactIdentity,
  isAuthenticated,
  merchantId,
  setCommittedAddress,
  setValue,
  settleContactTo,
}: UseCheckoutSavedAddressesParams) {
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<
    string | null
  >(null);
  // Starts true: with no saved addresses loaded yet, checkout opens on the
  // new-address editor (previously converged to true via a post-mount effect).
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(true);
  const [isLoadingSavedAddresses, setIsLoadingSavedAddresses] = useState(false);
  const [isContactCollapsed, setIsContactCollapsed] = useState(false);
  const [isDeliveryCollapsed, setIsDeliveryCollapsed] = useState(false);
  const [saveAsDefaultAddress, setSaveAsDefaultAddress] = useState(false);
  const hasHydratedSavedAddressRef = useRef(false);
  const initialHasContactIdentityRef = useRef(hasInitialContactIdentity);
  const hasSavedAddresses = isAuthenticated && savedAddresses.length > 0;
  const selectedSavedAddress =
    savedAddresses.find((item) => item.id === selectedSavedAddressId) ?? null;
  const defaultSavedAddress = getDefaultSavedAddress(savedAddresses);
  const [prevAddressContext, setPrevAddressContext] = useState({
    hasSavedAddresses,
    selectedSavedAddressId,
  });

  // Keep the editor mode consistent inline (pre-commit) when the saved-address
  // context changes, instead of one frame later via an effect.
  if (
    prevAddressContext.hasSavedAddresses !== hasSavedAddresses ||
    prevAddressContext.selectedSavedAddressId !== selectedSavedAddressId
  ) {
    setPrevAddressContext({ hasSavedAddresses, selectedSavedAddressId });
    if (!hasSavedAddresses) {
      setIsAddingNewAddress(true);
    } else if (selectedSavedAddressId) {
      setIsAddingNewAddress(false);
    }
  }

  const applySavedAddressToForm = (
    savedAddress: SavedAddress,
    options?: { collapse?: boolean }
  ) => {
    const checkoutValues = toCheckoutAddressValues(savedAddress);
    setValue('firstName', checkoutValues.firstName, { shouldValidate: true });
    setValue('lastName', checkoutValues.lastName, { shouldValidate: true });
    setValue('phone', checkoutValues.phone, { shouldValidate: true });
    setValue('address', checkoutValues.address, { shouldValidate: true });
    setValue('city', checkoutValues.city, { shouldValidate: true });
    setValue('state', checkoutValues.state, { shouldValidate: true });
    settleContactTo?.({
      firstName: checkoutValues.firstName,
      lastName: checkoutValues.lastName,
      phone: checkoutValues.phone,
    });
    setCommittedAddress(checkoutValues.address);
    setSelectedSavedAddressId(savedAddress.id);
    setIsAddingNewAddress(false);
    setSaveAsDefaultAddress(Boolean(savedAddress.is_default));

    if (options?.collapse !== false) {
      setIsContactCollapsed(true);
      setIsDeliveryCollapsed(true);
    }
  };
  const hydrateSavedAddress = useEffectEvent((savedAddress: SavedAddress) => {
    applySavedAddressToForm(savedAddress, { collapse: true });
  });

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAndHydrate = async () => {
      if (!isAuthenticated || !customerId) {
        setSavedAddresses([]);
        setSelectedSavedAddressId(null);
        setIsAddingNewAddress(true);
        setIsLoadingSavedAddresses(false);
        setIsContactCollapsed(false);
        setIsDeliveryCollapsed(false);
        setSaveAsDefaultAddress(false);
        hasHydratedSavedAddressRef.current = false;
        return;
      }

      setIsLoadingSavedAddresses(true);
      const nextAddresses = await fetchCheckoutSavedAddresses({
        customerId,
        merchantId,
        signal: abortController.signal,
      });
      // Unmounted or superseded by a newer fetch — drop this result.
      if (abortController.signal.aborted) {
        return;
      }
      setSavedAddresses(nextAddresses);
      setIsLoadingSavedAddresses(false);

      if (hasHydratedSavedAddressRef.current) return;
      const defaultAddr = getDefaultSavedAddress(nextAddresses);
      if (!defaultAddr) {
        setIsContactCollapsed(initialHasContactIdentityRef.current);
        setIsDeliveryCollapsed(false);
        setIsAddingNewAddress(true);
        setSaveAsDefaultAddress(true);
        hasHydratedSavedAddressRef.current = true;
        return;
      }

      hydrateSavedAddress(defaultAddr);
      hasHydratedSavedAddressRef.current = true;
    };

    fetchAndHydrate();

    return () => {
      abortController.abort();
    };
  }, [customerId, isAuthenticated, merchantId]);

  return {
    applySavedAddressToForm,
    defaultSavedAddress,
    hasSavedAddresses,
    isAddingNewAddress,
    isContactCollapsed,
    isDeliveryCollapsed,
    isLoadingSavedAddresses,
    openNewAddressEditor: () => {
      setSelectedSavedAddressId(null);
      setIsAddingNewAddress(true);
      setSaveAsDefaultAddress(savedAddresses.length <= 1);
    },
    saveAsDefaultAddress,
    savedAddresses,
    selectedSavedAddress,
    selectedSavedAddressId,
    setIsContactCollapsed,
    setIsDeliveryCollapsed,
    setSaveAsDefaultAddress,
  };
}
