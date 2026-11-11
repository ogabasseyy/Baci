// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { connectStyles } from './connect.styles';

describe('connectStyles', () => {
  it('defines core layout and form style entries', () => {
    expect(connectStyles.container).toBeDefined();
    expect(connectStyles.content).toBeDefined();
    expect(connectStyles.input).toBeDefined();
    expect(connectStyles.button).toBeDefined();
    expect(connectStyles.recordCard).toBeDefined();
  });
});
