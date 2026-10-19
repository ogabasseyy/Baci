import { describe, expect, it } from 'vitest';
import { maxDuration } from './route';

describe('POST /api/orders runtime contract', () => {
  it('caps checkout execution so postdeploy enforcement can drain old revisions', () => {
    expect(maxDuration).toBe(60);
  });
});
