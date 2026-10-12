import { expect, it } from 'vitest';
import { parseRemovalRemaining } from './parse-removal-remaining';

const TOKEN = 'a'.repeat(64);
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';

function contentFor(lines: string | null, token: string | null = TOKEN) {
  return {
    success: true as const,
    cart_url:
      lines === null
        ? 'https://ogabassey.com/cart'
        : `https://ogabassey.com/cart?guest_cart=${encodeURIComponent(lines)}`,
    cart_token: token,
  };
}

it('parses surviving lines from a valid removal response', () => {
  expect(
    parseRemovalRemaining(
      contentFor(
        JSON.stringify([{ product_id: SECOND, quantity: 2 }])
      ),
      TOKEN,
      PRODUCT
    )
  ).toEqual([{ product_id: SECOND, quantity: 2 }]);
});

it('treats a bare cart URL and an empty payload as fully emptied', () => {
  expect(parseRemovalRemaining(contentFor(null), TOKEN, PRODUCT)).toEqual(
    []
  );
  expect(parseRemovalRemaining(contentFor('[]'), TOKEN, PRODUCT)).toEqual(
    []
  );
});

it('rejects responses that keep the removed line or break trust', () => {
  const kept = contentFor(
    JSON.stringify([{ product_id: PRODUCT, quantity: 1 }])
  );
  expect(parseRemovalRemaining(kept, TOKEN, PRODUCT)).toBeNull();
  expect(
    parseRemovalRemaining(contentFor('[]', 'b'.repeat(64)), TOKEN, PRODUCT)
  ).toBeNull();
  expect(
    parseRemovalRemaining(
      { ...contentFor('[]'), cart_url: 'https://evil.example/cart' },
      TOKEN,
      PRODUCT
    )
  ).toBeNull();
  expect(() =>
    parseRemovalRemaining(
      { ...contentFor('[]'), cart_url: 'notaurl' },
      TOKEN,
      PRODUCT
    )
  ).toThrow();
});
