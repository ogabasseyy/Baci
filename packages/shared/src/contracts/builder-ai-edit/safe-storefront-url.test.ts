import { describe, expect, it } from 'vitest';
import { safeStorefrontUrlSchema } from './safe-storefront-url';

describe('safeStorefrontUrlSchema', () => {
  it('accepts storefront, anchor, and canonical HTTPS URLs', () => {
    for (const url of [
      '/collections/new',
      '#',
      '#newsletter',
      'https://example.test/shop',
      'HTTPS://example.test/shop',
    ]) {
      expect(safeStorefrontUrlSchema.safeParse(url).success).toBe(true);
    }
  });

  it.each([
    '//example.test',
    'https://',
    'https:example.test',
    'https:/example.test',
    'https://merchant:secret@example.test/private',
    'javascript:alert(1)',
    'https://example.test/a\\b',
  ])('rejects unsafe URL %s', (url) => {
    expect(safeStorefrontUrlSchema.safeParse(url).success).toBe(false);
  });
});
