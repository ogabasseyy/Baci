import { describe, expect, it } from 'vitest';

import { ASSURANCE_LINE_NAME } from './assurance-line-name';

describe('assurance-line-name', () => {
  it('exposes a non-empty canonical assurance receipt line name', () => {
    expect(ASSURANCE_LINE_NAME).toBe('Ogabassey Assurance');
    expect(ASSURANCE_LINE_NAME.trim()).toBe(ASSURANCE_LINE_NAME);
  });
});
