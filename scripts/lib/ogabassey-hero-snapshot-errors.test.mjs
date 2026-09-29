import { describe, expect, it } from 'vitest';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';

describe('HeroSnapshotError', () => {
  it('carries its name and message', () => {
    const error = new HeroSnapshotError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HeroSnapshotError');
    expect(error.message).toBe('boom');
  });
});
