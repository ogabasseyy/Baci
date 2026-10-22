import { describe, expect, it } from 'vitest';
import { parseDraftRevision } from './revision';

describe('opaque website revisions', () => {
  it('accepts only exact opaque tokens without numeric coercion', () => {
    const token = 'draft:20000000-0000-4000-8000-000000000001';
    expect(parseDraftRevision(token)).toBe(token);
    for (const value of ['1', 1, 'draft:invalid', null])
      expect(() => parseDraftRevision(value)).toThrow();
  });
});
