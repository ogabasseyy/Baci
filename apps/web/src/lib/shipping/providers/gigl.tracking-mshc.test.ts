import { describe, expect, it } from 'vitest';
import { isMshc } from './gigl.tracking-mshc';

describe('isMshc', () => {
  it('matches MSHC regardless of case and surrounding spaces', () => {
    expect(isMshc({ providerStatus: ' mshc ' })).toBe(1);
  });

  it('does not match other provider codes', () => {
    expect(isMshc({ providerStatus: 'MPIK' })).toBe(0);
    expect(isMshc({ providerStatus: '' })).toBe(0);
  });
});
