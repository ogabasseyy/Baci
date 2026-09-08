import { describe, expect, it, vi } from 'vitest';
import { resetDeliveryQuotesForAddressChange } from './reset-delivery-quotes-for-address-change';

describe('resetDeliveryQuotesForAddressChange', () => {
  it('clears stale delivery quotes when the address changes', () => {
    const setDeliveryMethod = vi.fn();
    const setSelectedQuoteId = vi.fn();
    const setShippingQuotes = vi.fn();

    resetDeliveryQuotesForAddressChange({
      setDeliveryMethod,
      setSelectedQuoteId,
      setShippingQuotes,
    });

    expect(setShippingQuotes).toHaveBeenCalledWith([]);
    expect(setSelectedQuoteId).toHaveBeenCalledWith('');
    expect(setDeliveryMethod).toHaveBeenCalledWith('door');
  });

  describe('bugfix: airport selection reset without a street address', () => {
    it('clears quotes without forcing door when preserveDeliveryMethod is set', () => {
      const setDeliveryMethod = vi.fn();
      resetDeliveryQuotesForAddressChange({
        setDeliveryMethod,
        setSelectedQuoteId: vi.fn(),
        setShippingQuotes: vi.fn(),
        preserveDeliveryMethod: true,
      });
      expect(setDeliveryMethod).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: stale autocomplete coordinates after selecting a saved address', () => {
    it('clears delivery coordinates when resetting quotes for an address change', () => {
      const clearDeliveryCoordinates = vi.fn();
      resetDeliveryQuotesForAddressChange({
        setDeliveryMethod: vi.fn(),
        setSelectedQuoteId: vi.fn(),
        setShippingQuotes: vi.fn(),
        clearDeliveryCoordinates,
      });
      expect(clearDeliveryCoordinates).toHaveBeenCalledOnce();
    });
  });
});
