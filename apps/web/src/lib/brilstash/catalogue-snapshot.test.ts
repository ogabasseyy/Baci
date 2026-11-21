import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  digestBrilStashPayload,
  prepareBrilStashSnapshot,
} from './catalogue-snapshot';

const first = {
  external_id: 'listing-first',
  category: 'Test category',
  description:
    'Condition: New. Specifications: 128GB. Box contents: Phone. Warranty: 30 days.',
  images: [{ url: 'https://images.example.invalid/photo.jpg' }],
  price_naira: 350000,
  product_url: 'https://shop.example.invalid/product',
  stock_quantity: 0,
  title: 'Test phone',
};
const second = { ...first, external_id: 'listing-second' };
const policies = {
  approvedExternalIds: [first.external_id, second.external_id],
  previousExternalIds: [],
  retiredExternalIds: [],
};

describe('prepareBrilStashSnapshot', () => {
  it('stages a sorted full candidate with the digest of exactly what is served', () => {
    const result = prepareBrilStashSnapshot([second, first], policies);
    expect(result).toEqual({
      ok: true,
      products: [first, second],
      payloadDigest: digestBrilStashPayload([first, second]),
      digestFormat: 'canonical-json-sha256-v1',
    });
  });

  it('rejects missing pilot rows and silent loss of a previously listed ID', () => {
    expect(prepareBrilStashSnapshot([first], policies)).toEqual({
      ok: false,
      code: 'incomplete_assortment',
    });
    expect(
      prepareBrilStashSnapshot([first], {
        ...policies,
        approvedExternalIds: [first.external_id],
        previousExternalIds: [first.external_id, second.external_id],
      })
    ).toEqual({ ok: false, code: 'unapproved_removal' });
  });

  it('accepts removal only for the explicitly retired listing', () => {
    const policy = {
      ...policies,
      approvedExternalIds: [first.external_id],
      previousExternalIds: [first.external_id, second.external_id],
      retiredExternalIds: [second.external_id],
    };
    expect(prepareBrilStashSnapshot([first], policy)).toMatchObject({
      ok: true,
    });
    expect(prepareBrilStashSnapshot([first, second], policy)).toMatchObject({
      ok: false,
      code: 'retired_listing',
    });
  });

  it('rejects duplicate IDs, invalid wire rows and empty input by default', () => {
    expect(prepareBrilStashSnapshot([first, first], policies)).toMatchObject({
      ok: false,
      code: 'duplicate_listing',
    });
    expect(
      prepareBrilStashSnapshot([{ ...first, internal: 'private' }], policies)
    ).toMatchObject({
      ok: false,
      code: 'invalid_payload',
    });
    expect(
      prepareBrilStashSnapshot([], {
        approvedExternalIds: [],
        previousExternalIds: [],
        retiredExternalIds: [],
      })
    ).toMatchObject({ ok: false, code: 'empty_assortment' });
  });
});

describe('digestBrilStashPayload', () => {
  it('rejects optional vendor model numbers until there is an approved pilot source', () => {
    expect(() =>
      digestBrilStashPayload([{ ...first, model_number: 'unreviewed' }])
    ).toThrow();
  });

  it('matches the PostgreSQL wire vector for fractional prices, Unicode and escaping', () => {
    const fixture = readFileSync(
      new URL(
        '../../../../../supabase/tests/brilstash_catalogue_digest.sql',
        import.meta.url
      ),
      'utf8'
    );
    const vector = fixture.split('$vector$')[1];
    if (!vector) throw new Error('Missing BrilStash SQL digest vector');
    const { payload, digest } = JSON.parse(vector);
    expect(digestBrilStashPayload(payload)).toBe(digest);
  });

  it('preserves the canonical JSON SHA-256 v1 digest for a known payload', () => {
    expect(digestBrilStashPayload([first])).toBe(
      'f68e508b4a28b1fd757b89dc3ea3936f1d40609bb11e001b994b25a8c4a38b44'
    );
  });

  it('ignores JSON object key order but binds price, listing order and image order', () => {
    const payload = [
      {
        ...first,
        images: [
          ...first.images,
          { url: 'https://images.example.invalid/second.jpg' },
        ],
      },
      second,
    ];
    const digest = digestBrilStashPayload(payload);
    const reordered = payload.map((row) =>
      Object.fromEntries(Object.entries(row).reverse())
    );
    expect(digestBrilStashPayload(reordered)).toBe(digest);
    expect(
      digestBrilStashPayload([{ ...payload[0], price_naira: 365000 }, second])
    ).not.toBe(digest);
    expect(digestBrilStashPayload([...payload].reverse())).not.toBe(digest);
    expect(
      digestBrilStashPayload([
        { ...payload[0], images: [...payload[0].images].reverse() },
        second,
      ])
    ).not.toBe(digest);
  });
});
