import { describe, expect, it } from 'vitest';
import {
  findMatchingCartLineIndex,
  resolveCartLineAssurance,
} from './cart-line-merge-policy';
import type { CartItem } from './cart-types';

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'p1',
    quantity: 1,
    ...overrides,
  } as CartItem;
}

describe('findMatchingCartLineIndex', () => {
  it('matches a V2 line by cartItemId', () => {
    const prev = [line({ cartItemId: 'p1::red' })];

    expect(
      findMatchingCartLineIndex(prev, {
        productId: 'p1',
        cartItemId: 'p1::red',
      })
    ).toBe(0);
  });

  it('does not merge an exact-offer add into a legacy V1 line', () => {
    const prev = [line({ cartItemId: 'p1-red' })];

    expect(
      findMatchingCartLineIndex(prev, {
        productId: 'p1',
        cartItemId: 'p1::offer-9',
        options: { color: 'red' },
        normalizedOptions: { color: 'red', offerId: 'offer-9' },
      })
    ).toBe(-1);
  });

  it('merges a non-offer add into a matching legacy V1 line', () => {
    const prev = [line({ cartItemId: 'p1-red' })];

    expect(
      findMatchingCartLineIndex(prev, {
        productId: 'p1',
        cartItemId: 'p1::red',
        options: { color: 'red' },
        normalizedOptions: { color: 'red' },
      })
    ).toBe(0);
  });

  it('keeps ID-less legacy lines with different offers apart', () => {
    const prev = [line({ cartItemId: '', offerId: 'offer-1' })];

    expect(
      findMatchingCartLineIndex(prev, {
        productId: 'p1',
        cartItemId: 'p1::offer-2',
        normalizedOptions: { offerId: 'offer-2' },
      })
    ).toBe(-1);
  });

  it('merges ID-less legacy lines with the same offer', () => {
    const prev = [line({ cartItemId: '', offerId: 'offer-1' })];

    expect(
      findMatchingCartLineIndex(prev, {
        productId: 'p1',
        cartItemId: 'p1::offer-1',
        normalizedOptions: { offerId: 'offer-1' },
      })
    ).toBe(0);
  });
});

describe('resolveCartLineAssurance', () => {
  it('defaults new Ogabassey Smart Cart Pro lines on', () => {
    expect(
      resolveCartLineAssurance(undefined, undefined, {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
      })
    ).toBe(true);
  });

  it('keeps quiz-voucher lines off unless explicitly chosen', () => {
    expect(
      resolveCartLineAssurance({ quizAwardId: 'quiz-1' }, undefined, {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
      })
    ).toBe(false);
    expect(
      resolveCartLineAssurance(
        { quizAwardId: 'quiz-1', hasAssurance: true },
        undefined,
        {
          smartCartProEnabled: true,
          merchantSlug: 'ogabassey',
        }
      )
    ).toBe(true);
  });

  it('preserves the stored choice on merge when the add is silent', () => {
    expect(
      resolveCartLineAssurance(
        undefined,
        { hasAssurance: false },
        {
          smartCartProEnabled: true,
          merchantSlug: 'ogabassey',
        }
      )
    ).toBe(false);
  });

  it('forwards an explicit insurance opt-out to disable the default', () => {
    expect(
      resolveCartLineAssurance(undefined, undefined, {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: false,
      })
    ).toBe(false);
    expect(
      resolveCartLineAssurance(undefined, undefined, {
        smartCartProEnabled: true,
        merchantSlug: 'ogabassey',
        shippingInsuranceEnabled: true,
      })
    ).toBe(true);
  });
});
