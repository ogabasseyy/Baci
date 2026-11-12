// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { negotiationCardStyles } from './NegotiationCard.styles';

describe('negotiationCardStyles', () => {
  it('keeps the repeated negotiation card sections styled', () => {
    expect(negotiationCardStyles.card).toEqual(
      expect.objectContaining({ borderRadius: expect.any(Number) })
    );
    expect(negotiationCardStyles.cartToggle).toEqual(
      expect.objectContaining({ flexDirection: 'row' })
    );
    expect(negotiationCardStyles.itemMetaChips).toEqual(
      expect.objectContaining({ flexDirection: 'row', flexWrap: 'wrap' })
    );
    expect(negotiationCardStyles.actionRow).toEqual(
      expect.objectContaining({ flexDirection: 'row' })
    );
  });
});
