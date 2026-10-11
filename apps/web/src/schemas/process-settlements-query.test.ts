import { describe, expect, it } from 'vitest';
import { processSettlementsQuerySchema } from './process-settlements-query';

describe('processSettlementsQuerySchema', () => {
  it.each([
    'true',
    'false',
    undefined,
  ])('accepts cancellationsOnly=%s', (value) => {
    expect(
      processSettlementsQuerySchema.safeParse({ cancellationsOnly: value })
        .success
    ).toBe(true);
  });

  it.each(['1', 'True', 'yes', ''])('rejects cancellationsOnly=%s', (value) => {
    expect(
      processSettlementsQuerySchema.safeParse({ cancellationsOnly: value })
        .success
    ).toBe(false);
  });
});
