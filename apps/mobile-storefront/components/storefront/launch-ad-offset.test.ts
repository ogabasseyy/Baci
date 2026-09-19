import { describe, expect, it } from '@jest/globals';
import { nextOffsetAfterAdToggle } from './launch-ad-offset';

// Card width 340 plus one 12px gap: the ad slot starts at x = 352.
const AD_SLOT_WIDTH = 352;
const INSERTION_OFFSET = 352;

describe('nextOffsetAfterAdToggle', () => {
  it('leaves the offset alone when ad visibility is unchanged', () => {
    // Arrange & Act & Assert
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: true,
        scrollOffset: 400,
        wasAdShown: true,
      })
    ).toBeNull();
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
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
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: true,
        scrollOffset: 0,
        wasAdShown: false,
      })
    ).toBeNull();
  });

  it('leaves a slightly scrolled first card alone when the ad appears', () => {
    // Arrange & Act & Assert: scrolled a few pixels into the first card,
    // inserting the ad after that card moves nothing visible, so applying
    // a full slot delta would jump the carousel forward.
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: true,
        scrollOffset: 40,
        wasAdShown: false,
      })
    ).toBeNull();
  });

  it('leaves a slightly scrolled first card alone when the ad is removed', () => {
    // Arrange & Act & Assert: removal must not snap a slightly scrolled
    // first card back to zero.
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: false,
        scrollOffset: 100,
        wasAdShown: true,
      })
    ).toBeNull();
  });

  it('shifts the offset by one slot when the ad appears past the insertion point', () => {
    // Arrange & Act
    const offset = nextOffsetAfterAdToggle({
      adSlotWidth: AD_SLOT_WIDTH,
      insertionOffset: INSERTION_OFFSET,
      isAdShown: true,
      scrollOffset: 400,
      wasAdShown: false,
    });

    // Assert: the same product stays under the viewport.
    expect(offset).toBe(752);
  });

  it('shifts the offset back when the ad is removed past the insertion point, floored at zero', () => {
    // Arrange & Act & Assert
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: false,
        scrollOffset: 400,
        wasAdShown: true,
      })
    ).toBe(48);
    expect(
      nextOffsetAfterAdToggle({
        adSlotWidth: AD_SLOT_WIDTH,
        insertionOffset: INSERTION_OFFSET,
        isAdShown: false,
        scrollOffset: INSERTION_OFFSET,
        wasAdShown: true,
      })
    ).toBe(0);
  });
});
