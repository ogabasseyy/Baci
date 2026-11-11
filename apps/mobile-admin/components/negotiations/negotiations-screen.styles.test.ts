// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { negotiationScreenStyles } from './negotiations-screen.styles';

describe('negotiationScreenStyles', () => {
  it('keeps the screen, empty state, and retry controls styled', () => {
    expect(negotiationScreenStyles.container).toEqual(
      expect.objectContaining({ flex: 1 })
    );
    expect(negotiationScreenStyles.emptyContainer).toEqual(
      expect.objectContaining({ alignItems: 'center' })
    );
    expect(negotiationScreenStyles.retryButton).toEqual(
      expect.objectContaining({ flexDirection: 'row' })
    );
    expect(negotiationScreenStyles.centered).toEqual(
      expect.objectContaining({ justifyContent: 'center' })
    );
    expect(negotiationScreenStyles.listContent).toEqual(
      expect.objectContaining({ padding: expect.any(Number) })
    );
    expect(negotiationScreenStyles.emptyTitle).toEqual(
      expect.objectContaining({ fontWeight: '600' })
    );
    expect(negotiationScreenStyles.emptySubtitle).toEqual(
      expect.objectContaining({ textAlign: 'center' })
    );
    expect(negotiationScreenStyles.retryText).toEqual(
      expect.objectContaining({ fontWeight: '600' })
    );
  });
});
