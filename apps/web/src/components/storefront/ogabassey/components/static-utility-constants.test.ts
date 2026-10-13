import { describe, expect, it } from 'vitest';
import { STATIC_ACTIVE_WORD_INDEX } from './static-utility-constants';

describe('static-utility-constants', () => {
  it('keeps the default active word on the first promo word', () => {
    // Both utility twins (interactive panel and zero-JS static twin)
    // render the same default-visible word; drift breaks swap parity.
    expect(STATIC_ACTIVE_WORD_INDEX).toBe(0);
  });
});
