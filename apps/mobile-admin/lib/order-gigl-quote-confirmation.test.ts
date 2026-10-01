import { describe, expect, it } from 'vitest';
import { resolveOrderGiglQuoteConfirmationGate } from './order-gigl-quote-confirmation';

describe('resolveOrderGiglQuoteConfirmationGate', () => {
  const ready = {
    confirmationInFlight: false,
    preview: false,
    quoteBound: true,
    hasQuote: true,
    canBook: true,
    quoteFresh: true,
  };

  it('allows a fresh bound bookable quote', () => {
    expect(resolveOrderGiglQuoteConfirmationGate(ready)).toBe('allow');
  });

  it('refreshes when the bound quote is stale', () => {
    expect(
      resolveOrderGiglQuoteConfirmationGate({ ...ready, quoteFresh: false })
    ).toBe('refresh');
  });

  it('bugfix: allows expired quotes when a bound charge needs recovery', () => {
    expect(
      resolveOrderGiglQuoteConfirmationGate({
        ...ready,
        quoteFresh: false,
        boundChargeRecovery: true,
      })
    ).toBe('allow');
  });

  it('denies preview or unbound quotes even when canBook is true', () => {
    expect(
      resolveOrderGiglQuoteConfirmationGate({ ...ready, preview: true })
    ).toBe('deny');
    expect(
      resolveOrderGiglQuoteConfirmationGate({ ...ready, quoteBound: false })
    ).toBe('deny');
  });
});
