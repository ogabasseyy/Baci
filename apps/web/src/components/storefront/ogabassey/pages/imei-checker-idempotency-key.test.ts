import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImeiIdempotencyKey } from './imei-checker-idempotency-key';

describe('createImeiIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
    });

    expect(createImeiIdempotencyKey()).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('throws when secure random bytes are unavailable', () => {
    vi.stubGlobal('crypto', {});

    expect(() => createImeiIdempotencyKey()).toThrow('Secure crypto unavailable');
  });
});
