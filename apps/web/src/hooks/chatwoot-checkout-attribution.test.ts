import { beforeEach, describe, expect, it } from 'vitest';
import {
  pinChatwootCheckoutAttribution,
  resetChatwootCheckoutAttribution,
} from './chatwoot-checkout-attribution';

beforeEach(() => resetChatwootCheckoutAttribution());

describe('pinChatwootCheckoutAttribution', () => {
  it('keeps the first snapshot for a request when cookies later change', () => {
    const first = { fbc: 'click-1' };

    expect(pinChatwootCheckoutAttribution('key-1', first)).toBe(first);
    expect(pinChatwootCheckoutAttribution('key-1', { fbc: 'click-2' })).toBe(
      first
    );
  });

  it('pins each request separately, including an empty snapshot', () => {
    const empty = {};

    expect(pinChatwootCheckoutAttribution('key-1', empty)).toBe(empty);
    expect(pinChatwootCheckoutAttribution('key-1', { fbc: 'later' })).toBe(
      empty
    );
    expect(pinChatwootCheckoutAttribution('key-2', { fbc: 'other' })).toEqual({
      fbc: 'other',
    });
  });

  it('forgets the oldest request past its bound', () => {
    pinChatwootCheckoutAttribution('key-0', { fbc: 'old' });
    for (let index = 1; index <= 20; index += 1) {
      pinChatwootCheckoutAttribution(`key-${index}`, { fbc: `c-${index}` });
    }

    expect(pinChatwootCheckoutAttribution('key-0', { fbc: 'new' })).toEqual({
      fbc: 'new',
    });
  });
});
