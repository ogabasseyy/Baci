import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNewCustomerDraft } from '@/components/orders/new-order.defaults';
import { createNewOrderCustomerActions } from './createNewOrderCustomerActions';

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

type CustomerActionsParams = Parameters<
  typeof createNewOrderCustomerActions
>[0];

function makeActions(overrides: Partial<CustomerActionsParams> = {}) {
  return createNewOrderCustomerActions({
    createCustomer: vi.fn(),
    merchantId: 'merchant-1',
    newCustomer: createEmptyNewCustomerDraft(),
    setCustomer: vi.fn(),
    setCustomerSearch: vi.fn(),
    setDuplicateCustomer: vi.fn(),
    setIsCreatingCustomer: vi.fn(),
    setNewCustomer: vi.fn(),
    setSelectedCountryCode: vi.fn(),
    setShowCustomerModal: vi.fn(),
    ...overrides,
  });
}

describe('createNewOrderCustomerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the new-customer draft on close (autosave) and clears transient state', () => {
    const setShowCustomerModal = vi.fn();
    const setIsCreatingCustomer = vi.fn();
    const setNewCustomer = vi.fn();
    const setSelectedCountryCode = vi.fn();
    const setDuplicateCustomer = vi.fn();
    const setCustomerSearch = vi.fn();
    const actions = makeActions({
      setCustomerSearch,
      setDuplicateCustomer,
      setIsCreatingCustomer,
      setNewCustomer,
      setSelectedCountryCode,
      setShowCustomerModal,
    });

    actions.handleCloseCustomerModal();

    expect(setShowCustomerModal).toHaveBeenCalledWith(false);
    expect(setIsCreatingCustomer).toHaveBeenCalledWith(false);
    expect(setDuplicateCustomer).toHaveBeenCalledWith(null);
    expect(setCustomerSearch).toHaveBeenCalledWith('');
    // Draft is preserved: the form/country are NOT reset on dismiss.
    expect(setNewCustomer).not.toHaveBeenCalled();
    expect(setSelectedCountryCode).not.toHaveBeenCalled();
  });

  it('requires first name and phone before creating a customer', async () => {
    await makeActions().handleCreateCustomer();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Required',
      'First Name and Phone are required'
    );
  });

  it('prefers full names and falls back through email, phone, then unknown when selecting a customer', () => {
    const setCustomer = vi.fn();
    const actions = makeActions({ setCustomer });
    const emptyLocality = {
      city: '',
      country: '',
      countryCode: '',
      latitude: undefined,
      longitude: undefined,
      postalCode: '',
      state: '',
    };

    [
      {
        expected: {
          address: '12 Allen Avenue',
          email: 'ada@example.com',
          id: 'customer-1',
          name: 'Ada Lovelace',
          phone: '08012345678',
          ...emptyLocality,
        },
        input: {
          address: '12 Allen Avenue',
          company_name: null,
          customer_type: 'individual' as const,
          email: 'ada@example.com',
          first_name: 'Ada',
          full_name: 'Ada Lovelace',
          id: 'customer-1',
          last_name: 'Lovelace',
          phone: '08012345678',
        },
      },
      {
        expected: {
          address: '',
          email: 'merchant-owner@example.com',
          id: 'customer-2',
          name: 'merchant-owner',
          phone: '',
          ...emptyLocality,
        },
        input: {
          address: null,
          company_name: null,
          customer_type: 'individual' as const,
          email: 'merchant-owner@example.com',
          first_name: null,
          full_name: null,
          id: 'customer-2',
          last_name: null,
          phone: null,
        },
      },
      {
        expected: {
          address: '',
          email: '',
          id: 'customer-3',
          name: '08099999999',
          phone: '08099999999',
          ...emptyLocality,
        },
        input: {
          address: null,
          company_name: null,
          customer_type: 'individual' as const,
          email: null,
          first_name: null,
          full_name: null,
          id: 'customer-3',
          last_name: null,
          phone: '08099999999',
        },
      },
      {
        expected: {
          address: '',
          email: '',
          id: 'customer-4',
          name: 'Unknown',
          phone: '',
          ...emptyLocality,
        },
        input: {
          address: null,
          company_name: null,
          customer_type: 'individual' as const,
          email: null,
          first_name: null,
          full_name: null,
          id: 'customer-4',
          last_name: null,
          phone: null,
        },
      },
    ].forEach(({ expected, input }, index) => {
      actions.handleSelectCustomer(input);
      expect(setCustomer).toHaveBeenNthCalledWith(index + 1, expected);
    });
  });

  it('bugfix: preserves structured locality when reusing an existing customer', () => {
    const setCustomer = vi.fn();
    const actions = makeActions({ setCustomer });

    actions.handleSelectCustomer({
      address: '12 Allen Avenue',
      city: 'Ikeja',
      company_name: null,
      country: 'Nigeria',
      country_code: 'NG',
      customer_type: 'individual',
      email: 'ada@example.com',
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      id: 'customer-locality',
      last_name: 'Lovelace',
      latitude: 6.6018,
      longitude: 3.3515,
      phone: '08012345678',
      state: 'Lagos',
      zip_code: '100001',
    });

    expect(setCustomer).toHaveBeenCalledWith({
      address: '12 Allen Avenue',
      city: 'Ikeja',
      country: 'Nigeria',
      countryCode: 'NG',
      email: 'ada@example.com',
      id: 'customer-locality',
      latitude: 6.6018,
      longitude: 3.3515,
      name: 'Ada Lovelace',
      phone: '08012345678',
      postalCode: '100001',
      state: 'Lagos',
    });
  });
});
