import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectableCustomer } from '@/components/orders/new-order.types';
import { createNewOrderCustomerActions } from './createNewOrderCustomerActions';

interface DuplicateLookupResponse {
  data: SelectableCustomer[] | null;
  error: { message: string } | null;
}

const mocks = vi.hoisted(() => {
  const eqCalls: [string, unknown][] = [];
  const ilikeCalls: [string, string][] = [];
  const isCalls: [string, unknown][] = [];
  const limitCalls: number[] = [];
  const responses: DuplicateLookupResponse[] = [];
  const builder = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    }),
    ilike: vi.fn((column: string, value: string) => {
      ilikeCalls.push([column, value]);
      return builder;
    }),
    is: vi.fn((column: string, value: unknown) => {
      isCalls.push([column, value]);
      return builder;
    }),
    limit: vi.fn((value: number) => {
      limitCalls.push(value);
      return Promise.resolve(responses.shift() ?? { data: [], error: null });
    }),
    or: vi.fn(),
    select: vi.fn(() => builder),
  };

  return {
    builder,
    eqCalls,
    ilikeCalls,
    isCalls,
    limitCalls,
    or: builder.or,
    queueResponse(response: DuplicateLookupResponse) {
      responses.push(response);
    },
    reset() {
      eqCalls.length = 0;
      ilikeCalls.length = 0;
      isCalls.length = 0;
      limitCalls.length = 0;
      responses.length = 0;
      builder.eq.mockClear();
      builder.ilike.mockClear();
      builder.is.mockClear();
      builder.limit.mockClear();
      builder.or.mockClear();
      builder.select.mockClear();
    },
  };
});

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => mocks.builder,
  },
}));

type CustomerActionsParams = Parameters<
  typeof createNewOrderCustomerActions
>[0];

const baseNewCustomer = {
  address: '',
  companyName: '',
  customerType: 'individual' as const,
  email: '',
  firstName: 'Ada',
  lastName: '',
  phone: '08012345678',
};

function makeActions(overrides: Partial<CustomerActionsParams> = {}) {
  return createNewOrderCustomerActions({
    createCustomer: vi.fn(),
    merchantId: 'merchant-1',
    newCustomer: baseNewCustomer,
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

describe('createNewOrderCustomerActions.handleCreateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
  });

  it('checks duplicates without using a raw or filter and reuses an existing phone match', async () => {
    const setDuplicateCustomer = vi.fn();
    const createCustomer = vi.fn();
    mocks.queueResponse({
      data: [
        {
          address: '12 Allen Avenue',
          company_name: null,
          customer_type: 'individual',
          email: 'ada@example.com',
          first_name: 'Ada',
          full_name: 'Ada Lovelace',
          id: 'customer-1',
          last_name: 'Lovelace',
          phone: '08012345678',
        },
      ],
      error: null,
    });

    await makeActions({
      createCustomer,
      newCustomer: {
        ...baseNewCustomer,
        address: '',
        companyName: '',
        customerType: 'individual',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '08012345678',
      },
      setDuplicateCustomer,
    }).handleCreateCustomer();

    expect(mocks.or).not.toHaveBeenCalled();
    expect(mocks.eqCalls).toEqual([
      ['merchant_id', 'merchant-1'],
      ['phone', '08012345678'],
    ]);
    expect(mocks.isCalls).toEqual([['deleted_at', null]]);
    expect(mocks.limitCalls).toEqual([1]);
    expect(setDuplicateCustomer).toHaveBeenCalledWith({
      address: '12 Allen Avenue',
      company_name: null,
      customer_type: 'individual',
      email: 'ada@example.com',
      first_name: 'Ada',
      full_name: 'Ada Lovelace',
      id: 'customer-1',
      last_name: 'Lovelace',
      phone: '08012345678',
    });
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('falls back to a normalized case-insensitive email duplicate lookup when the phone lookup misses', async () => {
    const setDuplicateCustomer = vi.fn();
    mocks.queueResponse({ data: [], error: null });
    mocks.queueResponse({
      data: [
        {
          address: '12 Allen Avenue',
          company_name: null,
          customer_type: 'individual',
          email: 'ada@example.com',
          first_name: null,
          full_name: null,
          id: 'customer-1',
          last_name: null,
          phone: null,
        },
      ],
      error: null,
    });

    await makeActions({
      newCustomer: {
        ...baseNewCustomer,
        address: '',
        companyName: '',
        customerType: 'individual',
        email: ' ADA@EXAMPLE.COM ',
        firstName: 'Ada',
        lastName: '',
        phone: '08012345678',
      },
      setDuplicateCustomer,
    }).handleCreateCustomer();

    expect(mocks.eqCalls).toEqual([
      ['merchant_id', 'merchant-1'],
      ['phone', '08012345678'],
      ['merchant_id', 'merchant-1'],
    ]);
    expect(mocks.ilikeCalls).toEqual([['email', 'ada@example.com']]);
    expect(mocks.limitCalls).toEqual([1, 1]);
    expect(setDuplicateCustomer).toHaveBeenCalledWith({
      address: '12 Allen Avenue',
      company_name: null,
      customer_type: 'individual',
      email: 'ada@example.com',
      first_name: null,
      full_name: null,
      id: 'customer-1',
      last_name: null,
      phone: null,
    });
  });

  it('escapes email wildcard characters before duplicate lookup', async () => {
    const createCustomer = vi.fn().mockResolvedValue({
      address: '',
      email: 'john_doe%promo@example.com',
      first_name: 'John',
      id: 'customer-99',
      last_name: '',
      phone: '08012345678',
    });

    mocks.queueResponse({ data: [], error: null });
    mocks.queueResponse({ data: [], error: null });

    await makeActions({
      createCustomer,
      newCustomer: {
        ...baseNewCustomer,
        email: 'john_doe%promo@example.com',
        firstName: 'John',
        phone: '08012345678',
      },
    }).handleCreateCustomer();

    expect(mocks.ilikeCalls).toEqual([
      ['email', 'john\\_doe\\%promo@example.com'],
    ]);
    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'john_doe%promo@example.com',
      })
    );
  });

  it('creates and selects a customer with normalized contact fields when duplicate checks pass', async () => {
    const createCustomer = vi.fn().mockResolvedValue({
      address: '12 Allen Avenue',
      email: 'ada@example.com',
      first_name: 'Ada',
      id: 'customer-99',
      last_name: 'Lovelace',
      phone: '08012345678',
    });
    const setCustomer = vi.fn();
    const setCustomerSearch = vi.fn();
    const setIsCreatingCustomer = vi.fn();
    const setNewCustomer = vi.fn();
    const setShowCustomerModal = vi.fn();

    mocks.queueResponse({ data: [], error: null });
    mocks.queueResponse({ data: [], error: null });

    await makeActions({
      createCustomer,
      newCustomer: {
        ...baseNewCustomer,
        address: ' 12 Allen Avenue ',
        companyName: '',
        customerType: 'individual',
        email: ' ADA@EXAMPLE.COM ',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        phone: ' 08012345678 ',
      },
      setCustomer,
      setCustomerSearch,
      setIsCreatingCustomer,
      setNewCustomer,
      setShowCustomerModal,
    }).handleCreateCustomer();

    expect(createCustomer).toHaveBeenCalledWith({
      address: '12 Allen Avenue',
      city: undefined,
      company_name: undefined,
      country: undefined,
      country_code: undefined,
      customer_type: 'individual',
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      latitude: undefined,
      longitude: undefined,
      phone: '08012345678',
      state: undefined,
      zip_code: undefined,
    });
    expect(setCustomer).toHaveBeenNthCalledWith(1, {
      address: '12 Allen Avenue',
      city: '',
      country: '',
      countryCode: '',
      email: 'ada@example.com',
      id: 'customer-99',
      latitude: undefined,
      longitude: undefined,
      name: 'Ada Lovelace',
      phone: '08012345678',
      postalCode: '',
      state: '',
    });
    expect(setShowCustomerModal).toHaveBeenCalledWith(false);
    expect(setCustomerSearch).toHaveBeenCalledWith('');
    expect(setIsCreatingCustomer).toHaveBeenCalledWith(false);
    expect(setNewCustomer).toHaveBeenCalled();
  });

  it('creates a company customer with the company name and empty person names', async () => {
    const createCustomer = vi.fn().mockResolvedValue({
      company_name: 'Acme Ltd',
      customer_type: 'company',
      email: 'ops@acme.com',
      first_name: null,
      id: 'customer-77',
      last_name: null,
      phone: '08012345678',
    });
    const setCustomer = vi.fn();

    mocks.queueResponse({ data: [], error: null });
    mocks.queueResponse({ data: [], error: null });

    await makeActions({
      createCustomer,
      newCustomer: {
        address: '',
        companyName: '  Acme Ltd ',
        customerType: 'company',
        email: 'ops@acme.com',
        firstName: '',
        lastName: '',
        phone: '08012345678',
      },
      setCustomer,
    }).handleCreateCustomer();

    expect(createCustomer).toHaveBeenCalledWith({
      address: undefined,
      city: undefined,
      company_name: 'Acme Ltd',
      country: undefined,
      country_code: undefined,
      customer_type: 'company',
      email: 'ops@acme.com',
      first_name: '',
      last_name: '',
      latitude: undefined,
      longitude: undefined,
      phone: '08012345678',
      state: undefined,
      zip_code: undefined,
    });
    expect(setCustomer).toHaveBeenNthCalledWith(1, {
      address: '',
      city: '',
      country: '',
      countryCode: '',
      email: 'ops@acme.com',
      id: 'customer-77',
      latitude: undefined,
      longitude: undefined,
      name: 'Acme Ltd',
      phone: '08012345678',
      postalCode: '',
      state: '',
    });
  });

  it('requires a company name when creating a company customer', async () => {
    const createCustomer = vi.fn();

    await makeActions({
      createCustomer,
      newCustomer: {
        address: '',
        companyName: '   ',
        customerType: 'company',
        email: '',
        firstName: '',
        lastName: '',
        phone: '08012345678',
      },
    }).handleCreateCustomer();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Required',
      'Company Name and Phone are required'
    );
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('aborts customer creation when duplicate lookup fails', async () => {
    const createCustomer = vi.fn();
    mocks.queueResponse({
      data: null,
      error: { message: 'lookup failed' },
    });

    await makeActions({
      createCustomer,
      newCustomer: {
        ...baseNewCustomer,
        address: '',
        companyName: '',
        customerType: 'individual',
        email: '',
        firstName: 'Ada',
        lastName: '',
        phone: '08012345678',
      },
    }).handleCreateCustomer();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Unable to check for existing customers right now.'
    );
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('surfaces a safe fallback message when createCustomer throws a non-Error value', async () => {
    mocks.queueResponse({ data: [], error: null });

    await makeActions({
      createCustomer: vi.fn().mockRejectedValue('boom'),
      newCustomer: {
        ...baseNewCustomer,
        address: '',
        companyName: '',
        customerType: 'individual',
        email: '',
        firstName: 'Ada',
        lastName: '',
        phone: '08012345678',
      },
    }).handleCreateCustomer();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Unable to create customer right now.'
    );
  });
});
