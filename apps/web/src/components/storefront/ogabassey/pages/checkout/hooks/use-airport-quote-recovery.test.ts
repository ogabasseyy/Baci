import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAirportQuoteRecovery } from './use-airport-quote-recovery';
it('reopens delivery for a restored provider quote but leaves valid selections alone', () => {
  const recover = vi.fn();
  const { rerender } = renderHook(({ needsQuote }) => useAirportQuoteRecovery(needsQuote, 'payment', recover), { initialProps: { needsQuote: false } });
  expect(recover).not.toHaveBeenCalled();
  rerender({ needsQuote: true });
  expect(recover).toHaveBeenCalledOnce();
});
