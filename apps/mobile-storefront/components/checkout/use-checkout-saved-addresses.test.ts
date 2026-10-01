import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { UseFormSetValue } from 'react-hook-form';
import type { SavedAddress } from '@/lib/checkout-saved-address';
import type { ShippingAddressInput } from '@/lib/validation';
import { useCheckoutSavedAddresses } from './use-checkout-saved-addresses';

const mockFetchCheckoutSavedAddresses =
  jest.fn<(input: unknown) => Promise<SavedAddress[]>>();

jest.mock('@/lib/fetch-checkout-saved-addresses', () => ({
  fetchCheckoutSavedAddresses: (input: unknown) =>
    mockFetchCheckoutSavedAddresses(input),
}));

function createSavedAddress(
  overrides: Partial<SavedAddress> = {}
): SavedAddress {
  return {
    id: 'addr-1',
    label: 'Home',
    full_name: 'Ada Lovelace',
    phone: '08031234567',
    address: '1 Fig Street',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'NG',
    is_default: true,
    ...overrides,
  };
}

function renderSavedAddresses(
  overrides: Partial<Parameters<typeof useCheckoutSavedAddresses>[0]> = {}
) {
  const setValue = jest.fn();
  const setCommittedAddress = jest.fn();
  const utils = renderHook(() =>
    useCheckoutSavedAddresses({
      customerId: 'customer-1',
      hasInitialContactIdentity: false,
      isAuthenticated: true,
      merchantId: 'merchant-1',
      setCommittedAddress,
      setValue: setValue as unknown as UseFormSetValue<ShippingAddressInput>,
      ...overrides,
    })
  );
  return { ...utils, setValue, setCommittedAddress };
}

describe('useCheckoutSavedAddresses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchCheckoutSavedAddresses.mockResolvedValue([]);
  });

  it('does not fetch and opens the manual editor when unauthenticated', async () => {
    const { result } = renderSavedAddresses({
      isAuthenticated: false,
      customerId: undefined,
    });

    await waitFor(() =>
      expect(result.current.isLoadingSavedAddresses).toBe(false)
    );

    expect(mockFetchCheckoutSavedAddresses).not.toHaveBeenCalled();
    expect(result.current.savedAddresses).toEqual([]);
    expect(result.current.hasSavedAddresses).toBe(false);
    expect(result.current.isAddingNewAddress).toBe(true);
  });

  it('fetches with an abort signal and hydrates the default address into the form', async () => {
    const defaultAddress = createSavedAddress();
    mockFetchCheckoutSavedAddresses.mockResolvedValue([defaultAddress]);

    const { result, setValue, setCommittedAddress } = renderSavedAddresses();

    await waitFor(() =>
      expect(result.current.selectedSavedAddressId).toBe('addr-1')
    );

    expect(mockFetchCheckoutSavedAddresses).toHaveBeenCalledWith({
      customerId: 'customer-1',
      merchantId: 'merchant-1',
      signal: expect.any(AbortSignal),
    });
    expect(setValue).toHaveBeenCalledWith('firstName', 'Ada', {
      shouldValidate: true,
    });
    expect(setValue).toHaveBeenCalledWith('lastName', 'Lovelace', {
      shouldValidate: true,
    });
    expect(setValue).toHaveBeenCalledWith('address', '1 Fig Street', {
      shouldValidate: true,
    });
    expect(setCommittedAddress).toHaveBeenCalledWith('1 Fig Street');
    expect(result.current.hasSavedAddresses).toBe(true);
    expect(result.current.isAddingNewAddress).toBe(false);
    expect(result.current.isContactCollapsed).toBe(true);
    expect(result.current.isDeliveryCollapsed).toBe(true);
    expect(result.current.isLoadingSavedAddresses).toBe(false);
  });

  it('settles contact to the hydrated recipient so prefill does not stall', async () => {
    const defaultAddress = createSavedAddress({
      full_name: 'Bassey John',
      phone: '09169449282',
    });
    mockFetchCheckoutSavedAddresses.mockResolvedValue([defaultAddress]);
    const settleContactTo = jest.fn();

    const { result } = renderSavedAddresses({ settleContactTo });

    await waitFor(() =>
      expect(result.current.selectedSavedAddressId).toBe('addr-1')
    );

    expect(settleContactTo).toHaveBeenCalledWith({
      firstName: 'Bassey',
      lastName: 'John',
      phone: '+2349169449282',
    });
  });

  it('keeps manual entry available when no saved addresses load (fail-open)', async () => {
    mockFetchCheckoutSavedAddresses.mockResolvedValue([]);

    const { result, setValue } = renderSavedAddresses();

    await waitFor(() =>
      expect(result.current.isLoadingSavedAddresses).toBe(false)
    );

    expect(result.current.savedAddresses).toEqual([]);
    expect(result.current.hasSavedAddresses).toBe(false);
    expect(result.current.isAddingNewAddress).toBe(true);
    expect(result.current.saveAsDefaultAddress).toBe(true);
    expect(setValue).not.toHaveBeenCalled();
  });

  it('aborts the in-flight fetch on unmount and drops the late result', async () => {
    let resolveFetch: (addresses: SavedAddress[]) => void = () => undefined;
    let capturedSignal: AbortSignal | undefined;
    mockFetchCheckoutSavedAddresses.mockImplementation((input) => {
      capturedSignal = (input as { signal?: AbortSignal }).signal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    });

    const { unmount, setValue } = renderSavedAddresses();

    await waitFor(() =>
      expect(mockFetchCheckoutSavedAddresses).toHaveBeenCalled()
    );
    unmount();

    expect(capturedSignal?.aborted).toBe(true);

    // A result arriving after unmount must not hydrate the form
    resolveFetch([createSavedAddress()]);
    await Promise.resolve();
    expect(setValue).not.toHaveBeenCalled();
  });

  it('resets to the manual editor via openNewAddressEditor', async () => {
    mockFetchCheckoutSavedAddresses.mockResolvedValue([
      createSavedAddress(),
      createSavedAddress({ id: 'addr-2', is_default: false }),
    ]);

    const { result } = renderSavedAddresses();

    await waitFor(() =>
      expect(result.current.selectedSavedAddressId).toBe('addr-1')
    );

    act(() => {
      result.current.openNewAddressEditor();
    });

    await waitFor(() => expect(result.current.isAddingNewAddress).toBe(true));
    expect(result.current.selectedSavedAddressId).toBeNull();
    // With multiple saved addresses, a new one should not default silently
    expect(result.current.saveAsDefaultAddress).toBe(false);
  });
});
