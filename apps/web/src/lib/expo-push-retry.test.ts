import { describe, expect, it } from 'vitest';

import {
  DELIVERED_TOKENS_PAYLOAD_KEY,
  excludeDeliveredTokens,
  readDeliveredTokens,
  withDeliveredTokens,
} from './expo-push-retry';

describe('excludeDeliveredTokens', () => {
  const tokens = [
    { token: 'ExponentPushToken[m1]' },
    { token: 'ExponentPushToken[m2]' },
  ];

  it('drops tokens reached by an earlier partial attempt', () => {
    expect(excludeDeliveredTokens(tokens, ['ExponentPushToken[m1]'])).toEqual([
      { token: 'ExponentPushToken[m2]' },
    ]);
  });

  it('keeps every token when no exclusion set is provided', () => {
    expect(excludeDeliveredTokens(tokens)).toEqual(tokens);
    expect(excludeDeliveredTokens(tokens, [])).toEqual(tokens);
  });
});

describe('withDeliveredTokens', () => {
  it('records accepted tokens under the shared payload key', () => {
    expect(
      withDeliveredTokens({ type: 'new_order' }, ['ExponentPushToken[m1]'])
    ).toEqual({
      type: 'new_order',
      [DELIVERED_TOKENS_PAYLOAD_KEY]: ['ExponentPushToken[m1]'],
    });
  });

  it('leaves the payload untouched when nothing was delivered', () => {
    expect(withDeliveredTokens({ type: 'new_order' }, [])).toEqual({
      type: 'new_order',
    });
    expect(withDeliveredTokens(undefined, [])).toEqual({});
  });
});

describe('readDeliveredTokens', () => {
  it('reads tokens stored by withDeliveredTokens', () => {
    const payload = withDeliveredTokens({ type: 'new_order' }, [
      'ExponentPushToken[m1]',
      'ExponentPushToken[m2]',
    ]);
    expect(readDeliveredTokens(payload)).toEqual([
      'ExponentPushToken[m1]',
      'ExponentPushToken[m2]',
    ]);
  });

  it('returns an empty set for unknown payload shapes', () => {
    expect(readDeliveredTokens(null)).toEqual([]);
    expect(readDeliveredTokens(undefined)).toEqual([]);
    expect(readDeliveredTokens('nope')).toEqual([]);
    expect(readDeliveredTokens({})).toEqual([]);
    expect(
      readDeliveredTokens({ [DELIVERED_TOKENS_PAYLOAD_KEY]: 'not-an-array' })
    ).toEqual([]);
  });

  it('skips non-string entries', () => {
    expect(
      readDeliveredTokens({
        [DELIVERED_TOKENS_PAYLOAD_KEY]: ['ExponentPushToken[m1]', 42, null],
      })
    ).toEqual(['ExponentPushToken[m1]']);
  });
});
