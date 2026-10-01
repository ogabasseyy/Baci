import { describe, expect, it } from 'vitest';
import { STORE_NOT_PUBLISHED_CSS } from './store-not-published-css';

describe('STORE_NOT_PUBLISHED_CSS', () => {
  it('scopes upcoming-store rules without a CSS-module filename', () => {
    expect(STORE_NOT_PUBLISHED_CSS).toContain('.unpublished-store {');
    expect(STORE_NOT_PUBLISHED_CSS).toContain('.unpublished-store__title');
    expect(STORE_NOT_PUBLISHED_CSS).not.toContain('store-not-published-module');
  });
});
