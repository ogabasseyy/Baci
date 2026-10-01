import { describe, expect, it } from 'vitest';
import { matchesIdentifierDiscriminatorSegment } from './matches-identifier-discriminator-segment';

describe('matchesIdentifierDiscriminatorSegment', () => {
  it('matches the discriminator in the identifier comparison segment', () => {
    expect(
      matchesIdentifierDiscriminatorSegment(
        ['iphone', '15', '256gb', 'vs', 'iphone', '15', '128gb'],
        1,
        2,
        ['256gb'],
        false,
        false
      )
    ).toBe(true);
  });
});
