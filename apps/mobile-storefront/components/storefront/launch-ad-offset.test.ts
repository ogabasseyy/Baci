import { describe, expect, it } from '@jest/globals';
import { nextOffsetAfterAdToggle } from './launch-ad-offset';

describe('nextOffsetAfterAdToggle', () => {
  it('leaves the offset alone when ad visibility is unchanged', () => {
    // Arrange & Act & Assert
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: 340,
        isAdShown: true,
        scrollOffset: 400,
        wasAdShown: true,
      })
    ).toBeNull();
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: 340,
        isAdShown: false,
        scrollOffset: 400,
        wasAdShown: false,
      })
    ).toBeNull();
  });

  it('leaves the offset alone at the start of the list', () => {
    // Arrange & Act & Assert: the insertion point is offscreen, so the
    // visible first card never moves.
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: 340,
        isAdShown: true,
        scrollOffset: 0,
        wasAdShown: false,
      })
    ).toBeNull();
  });

  it('shifts the offset by one slot when the ad appears mid-scroll', () => {
    // Arrange & Act
    const offset = nextOffsetAfterAdToggle({
      adSlotWidth: 340,
      isAdShown: true,
      scrollOffset: 400,
      wasAdShown: false,
    });

    // Assert: the same product stays under the viewport.
    expect(offset).toBe(740);
  });

  it('shifts the offset back when the ad is removed, floored at zero', () => {
    // Arrange & Act & Assert
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: 340,
        isAdShown: false,
        scrollOffset: 400,
        wasAdShown: true,
      })
    ).toBe(60);
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: 340,
        isAdShown: false,
        scrollOffset: 100,
        wasAdShown: true,
      })
    ).toBe(0);
  });
});
