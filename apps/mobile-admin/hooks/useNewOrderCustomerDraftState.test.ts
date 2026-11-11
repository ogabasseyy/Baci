// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEmptyNewCustomerDraft } from '@/components/orders/new-order.defaults';
import { DEFAULT_COUNTRY_CODE } from '@/components/orders/new-order.shared';
import type { SelectableCustomer } from '@/components/orders/new-order.types';
import { useNewOrderCustomerDraftState } from './useNewOrderCustomerDraftState';

describe('useNewOrderCustomerDraftState', () => {
  it('starts with an empty search, closed create flow, and default country', () => {
    const { result } = renderHook(() => useNewOrderCustomerDraftState());

    expect(result.current.customerSearch).toBe('');
    expect(result.current.isCreatingCustomer).toBe(false);
    expect(result.current.newCustomer).toEqual(createEmptyNewCustomerDraft());
    expect(result.current.selectedCountryCode).toBe(DEFAULT_COUNTRY_CODE);
    expect(result.current.duplicateCustomer).toBeNull();
  });

  it('updates each draft field through its setter', () => {
    const { result } = renderHook(() => useNewOrderCustomerDraftState());
    const duplicate = { id: 'cus-1' } as SelectableCustomer;

    act(() => {
      result.current.setCustomerSearch('ada');
      result.current.setIsCreatingCustomer(true);
      result.current.setNewCustomer({
        ...createEmptyNewCustomerDraft(),
        firstName: 'Ada',
      });
      result.current.setSelectedCountryCode('GB');
      result.current.setDuplicateCustomer(duplicate);
    });

    expect(result.current.customerSearch).toBe('ada');
    expect(result.current.isCreatingCustomer).toBe(true);
    expect(result.current.newCustomer.firstName).toBe('Ada');
    expect(result.current.selectedCountryCode).toBe('GB');
    expect(result.current.duplicateCustomer).toBe(duplicate);
  });
});
