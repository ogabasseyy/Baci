import { describe, expect, it } from 'vitest';
import {
  coerceStoredReplayAmount,
  consumeUnambiguousOfferlessLine,
  projectStoredReplayLines,
  replayLineIdentityKey,
  type StoredReplayLine,
} from './replay-stored-economics';

describe('replayLineIdentityKey', () => {
  it('normalizes text, numbers, and booleans like the idempotency hash', () => {
    expect(
      replayLineIdentityKey({
        productId: '  Prod-1 ',
        offerId: 'Offer-9',
        quantity: '2',
        hasAssurance: true,
      })
    ).toBe(
      replayLineIdentityKey({
        productId: 'prod-1',
        offerId: 'offer-9',
        quantity: 2,
        hasAssurance: true,
      })
    );
  });

  it('coerces non-finite quantities to zero and non-strings to empty', () => {
    expect(
      replayLineIdentityKey({
        productId: 42,
        offerId: null,
        quantity: Number.NaN,
        hasAssurance: 'yes',
      })
    ).toBe('::::0::false');
  });

  it('distinguishes offers, quantities, and assurance', () => {
    const base = {
      productId: 'p',
      offerId: 'o1',
      quantity: 1,
      hasAssurance: false,
    };
    const key = replayLineIdentityKey(base);
    expect(replayLineIdentityKey({ ...base, offerId: 'o2' })).not.toBe(key);
    expect(replayLineIdentityKey({ ...base, quantity: 2 })).not.toBe(key);
    expect(replayLineIdentityKey({ ...base, hasAssurance: true })).not.toBe(
      key
    );
  });
});

describe('consumeUnambiguousOfferlessLine', () => {
  const line = (condition: string | null): StoredReplayLine => ({
    condition,
    fee: 100,
  });
  const parts = { productId: 'p', quantity: 1, hasAssurance: false };

  it('pops the single candidate for a reduced identity', () => {
    const key = replayLineIdentityKey({ ...parts, offerId: null });
    const offerlessLines = new Map([[key, [line('new')]]]);

    expect(consumeUnambiguousOfferlessLine(offerlessLines, parts)).toEqual(
      line('new')
    );
    expect(offerlessLines.get(key)).toEqual([]);
  });

  it('returns null when zero or several candidates exist', () => {
    const key = replayLineIdentityKey({ ...parts, offerId: null });
    expect(consumeUnambiguousOfferlessLine(new Map(), parts)).toBeNull();
    const ambiguous = new Map([[key, [line('new'), line('used')]]]);
    expect(consumeUnambiguousOfferlessLine(ambiguous, parts)).toBeNull();
    expect(ambiguous.get(key)).toHaveLength(2);
  });
});

describe('coerceStoredReplayAmount', () => {
  it.each([
    [1200, 1200],
    ['1200', 1200],
    [' 1200.5 ', 1200.5],
  ])('coerces %p to %p', (raw, expected) => {
    expect(coerceStoredReplayAmount(raw)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['  '],
    ['abc'],
    [Number.NaN],
  ])('fails open to null for %p', (raw) => {
    expect(coerceStoredReplayAmount(raw)).toBeNull();
  });
});

describe('projectStoredReplayLines', () => {
  it('returns empty maps for non-array projections', () => {
    const { lines, offerlessLines } = projectStoredReplayLines(null);
    expect(lines.size).toBe(0);
    expect(offerlessLines.size).toBe(0);
  });

  it('splits keyed and offerless lines and skips null products', () => {
    const { lines, offerlessLines } = projectStoredReplayLines([
      {
        product_id: 'p1',
        offer_id: 'o1',
        condition: 'new',
        assurance_fee: 100,
        quantity: 1,
        has_assurance: true,
      },
      {
        product_id: 'p2',
        offer_id: null,
        condition: 'used',
        assurance_fee: '50',
        quantity: 2,
        has_assurance: false,
      },
      { product_id: null, offer_id: 'o3' },
    ]);

    expect(lines.size).toBe(1);
    expect(offerlessLines.size).toBe(1);
    const keyed = lines.get(
      replayLineIdentityKey({
        productId: 'p1',
        offerId: 'o1',
        quantity: 1,
        hasAssurance: true,
      })
    );
    expect(keyed).toEqual([{ condition: 'new', fee: 100 }]);
    const offerless = offerlessLines.get(
      replayLineIdentityKey({
        productId: 'p2',
        offerId: null,
        quantity: 2,
        hasAssurance: false,
      })
    );
    expect(offerless).toEqual([{ condition: 'used', fee: 50 }]);
  });

  it('queues full duplicates behind one key in order', () => {
    const { lines } = projectStoredReplayLines([
      {
        product_id: 'p',
        offer_id: 'o',
        condition: 'new',
        assurance_fee: 100,
        quantity: 1,
        has_assurance: false,
      },
      {
        product_id: 'p',
        offer_id: 'o',
        condition: 'used',
        assurance_fee: 200,
        quantity: 1,
        has_assurance: false,
      },
    ]);

    const key = replayLineIdentityKey({
      productId: 'p',
      offerId: 'o',
      quantity: 1,
      hasAssurance: false,
    });
    expect(lines.get(key)).toEqual([
      { condition: 'new', fee: 100 },
      { condition: 'used', fee: 200 },
    ]);
  });

  it('nulls blank conditions and uncoercible fees', () => {
    const { lines } = projectStoredReplayLines([
      {
        product_id: 'p',
        offer_id: 'o',
        condition: '',
        assurance_fee: 'abc',
        quantity: 1,
        has_assurance: false,
      },
    ]);

    const key = replayLineIdentityKey({
      productId: 'p',
      offerId: 'o',
      quantity: 1,
      hasAssurance: false,
    });
    expect(lines.get(key)).toEqual([{ condition: null, fee: null }]);
  });
});
