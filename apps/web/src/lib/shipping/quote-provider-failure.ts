import type { ShippingQuote } from './types';

const failures = new WeakMap<ShippingQuote[], Error>();

function normalizeFailure(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error('Unknown shipping provider failure');
}

export const quoteProviderFailure = {
  mark(result: ShippingQuote[], reason: unknown): ShippingQuote[] {
    failures.set(result, normalizeFailure(reason));
    return result;
  },

  get(result: ShippingQuote[]): Error | undefined {
    return failures.get(result);
  },
};
