import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { collectPiggyvestWebhookSecrets } from './webhook-secret-union';
import { testKey } from './webhook-secret-union.test-support';

describe('testKey', () => {
  it('is deterministic for a label and distinct across labels', () => {
    expect(testKey('interest')).toBe(testKey('interest'));
    expect(testKey('interest')).not.toBe(testKey('shared'));
    expect(testKey('retained')).not.toBe(testKey('unloaded-retained'));
  });

  it('yields a 64-character hex secret that the key union accepts as a configured key', () => {
    const key = testKey('interest');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      collectPiggyvestWebhookSecrets({
        NODE_ENV: 'test',
        PIGGYVEST_SECRET_KEY: key,
      })
    ).toEqual([key]);
  });
});
