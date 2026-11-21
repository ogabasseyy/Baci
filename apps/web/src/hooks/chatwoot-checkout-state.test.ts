import { describe, expect, it } from 'vitest';
import { resolveChatwootCheckoutState } from './chatwoot-checkout-state';

describe('resolveChatwootCheckoutState', () => {
  it('resolves a state however it is typed to its canonical name', () => {
    expect(resolveChatwootCheckoutState('lagos')).toBe('Lagos');
    expect(resolveChatwootCheckoutState('LAGOS')).toBe('Lagos');
    expect(resolveChatwootCheckoutState('FCT')).toBe('Abuja (FCT)');
  });

  it('returns null for something that is not a Nigerian state', () => {
    expect(resolveChatwootCheckoutState('Atlantis')).toBeNull();
    expect(resolveChatwootCheckoutState('')).toBeNull();
  });
});
