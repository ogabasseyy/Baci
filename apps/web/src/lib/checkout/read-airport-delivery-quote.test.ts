import { describe, expect, it } from 'vitest';
import { readAirportQuote } from '@/lib/checkout/read-airport-delivery-quote';

describe('readAirportQuote', () => {
  it('reads the first quote from an RPC array', () => {
    expect(readAirportQuote([{ provider: 'GIGL' }])).toEqual({
      provider: 'GIGL',
    });
  });

  it('rejects non-record RPC values', () => {
    expect(readAirportQuote(null)).toBeNull();
    expect(readAirportQuote(['not a quote'])).toBeNull();
  });
});
