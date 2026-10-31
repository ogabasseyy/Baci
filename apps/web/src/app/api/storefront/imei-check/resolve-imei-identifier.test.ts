import { describe, expect, it } from 'vitest';
import { resolveImeiIdentifier } from './resolve-imei-identifier';

describe('resolveImeiIdentifier', () => {
  it('rejects overlong identifiers before normalization', () => {
    const result = resolveImeiIdentifier(
      '4901542032375189',
      'full',
      'smartphone'
    );
    expect(result.response?.status).toBe(400);
    expect(result.normalized).toBeNull();
  });
  it('keeps a valid IMEI for provider submission', () => {
    expect(
      resolveImeiIdentifier('490154203237518', 'full', 'smartphone')
    ).toEqual({ response: null, normalized: '490154203237518' });
  });
});
