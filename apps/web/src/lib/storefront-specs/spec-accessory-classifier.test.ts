import { describe, expect, it } from 'vitest';
import { isAccessoryLikeCategory } from './spec-accessory-classifier';

describe('isAccessoryLikeCategory', () => {
  it('recognizes accessory labels and slug forms', () => {
    expect(isAccessoryLikeCategory('Phone Accessories')).toBe(true);
    expect(isAccessoryLikeCategory('laptop-keyboard')).toBe(true);
    expect(isAccessoryLikeCategory('Camera Accessories')).toBe(true);
  });

  it('recognizes bands, straps, protectors, and grips as accessories', () => {
    for (const category of [
      'Smartwatch Bands',
      'Watch Straps',
      'Screen Protectors',
      'Camera Grip',
    ]) {
      expect(isAccessoryLikeCategory(category)).toBe(true);
    }
  });

  it('recognizes gift-card and digital-card categories as accessories', () => {
    for (const category of ['Gift Cards', 'gift-cards', 'Digital Cards']) {
      expect(isAccessoryLikeCategory(category)).toBe(true);
    }
  });

  it('recognizes camera accessory slugs such as memory cards and instant film', () => {
    for (const category of ['memory-cards', 'Memory Cards', 'instant-film']) {
      expect(isAccessoryLikeCategory(category)).toBe(true);
    }
  });

  it('does not classify ordinary devices as accessories', () => {
    expect(isAccessoryLikeCategory('Smartphones')).toBe(false);
    expect(isAccessoryLikeCategory('Cameras')).toBe(false);
  });
});
