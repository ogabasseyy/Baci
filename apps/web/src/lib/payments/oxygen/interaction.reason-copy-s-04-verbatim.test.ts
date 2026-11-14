import { describe, expect, it } from 'vitest';
import { OXYGEN_INTERACTION_REASON_COPY } from './interaction';
import { S04_MESSAGE_TABLE, SIX_REASONS } from './interaction.test-helpers';

describe('reason copy (S-04 verbatim)', () => {
  it.each(S04_MESSAGE_TABLE)('renders $reason verbatim from the S-04 table', ({
    reason,
    message,
  }) => {
    expect(OXYGEN_INTERACTION_REASON_COPY[reason]).toBe(message);
  });

  it('covers exactly the six reasons', () => {
    expect(Object.keys(OXYGEN_INTERACTION_REASON_COPY).sort()).toEqual(
      [...SIX_REASONS].sort()
    );
  });
});
