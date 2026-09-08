import { describe, expect, it, vi } from 'vitest';
import { doorQuote, stationQuote } from './delivery-quote-test-fixtures';
import { createSelectDeliveryMethod } from './create-select-delivery-method';

describe('createSelectDeliveryMethod', () => {
  it('binds delivery method selection to quote and method setters', () => {
    const setDeliveryMethod = vi.fn();
    const setSelectedQuoteId = vi.fn();
    const selectDeliveryMethod = createSelectDeliveryMethod({
      selectedQuoteId: 'door-1',
      setDeliveryMethod,
      setSelectedQuoteId,
      shippingQuotes: [doorQuote, stationQuote],
    });

    selectDeliveryMethod('pickup_station');

    expect(setSelectedQuoteId).toHaveBeenCalledWith('station-1');
    expect(setDeliveryMethod).toHaveBeenCalledWith('pickup_station');
  });
});
