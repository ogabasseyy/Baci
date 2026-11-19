import { describe, expect, it } from 'vitest';
import { validateNativeAnchor } from './native-link-checks';

describe('qualification canonical native anchor', () => {
  it('requires the exact host-derived URL and opener isolation', () => {
    expect(() =>
      validateNativeAnchor(
        'http://127.0.0.1:4100/products/device',
        '_blank',
        'noopener noreferrer'
      )
    ).not.toThrow();
    for (const href of [
      'javascript:alert(1)',
      'https://private.invalid/',
      'http://127.0.0.1:4100//evil',
      'http://127.0.0.1:4100/%2f%2fevil',
    ])
      expect(() =>
        validateNativeAnchor(href, '_blank', 'noopener noreferrer')
      ).toThrow();
    expect(() =>
      validateNativeAnchor(
        'http://127.0.0.1:4100/products/device',
        '_blank',
        null
      )
    ).toThrow();
  });
});
