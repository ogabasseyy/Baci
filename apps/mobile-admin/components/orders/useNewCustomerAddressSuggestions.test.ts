import { describe, expect, it } from 'vitest';
import { useNewCustomerAddressSuggestions } from './useNewCustomerAddressSuggestions';

describe('useNewCustomerAddressSuggestions', () => {
  it('exports the autocomplete suggestions hook', () => {
    expect(typeof useNewCustomerAddressSuggestions).toBe('function');
  });
});
