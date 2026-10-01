import { describe, expect, it } from 'vitest';
import { isAccessoryLikeCategory } from './spec-accessory-classifier';
import { getProductSpecFamily } from './spec-family-classifier';

describe('spec family classifier', () => {
  it('recognizes display-name and slug forms of camera categories', () => {
    for (const category of ['Cameras', 'Drones', 'Gimbals']) {
      expect(getProductSpecFamily(category)).toBe('camera');
    }
  });

  it('does not classify ordinary device accessories as cameras', () => {
    expect(getProductSpecFamily('Phone Accessories')).toBe('general');
    expect(getProductSpecFamily('PC Accessories')).toBe('general');
    expect(getProductSpecFamily('Laptop Keyboard')).toBe('general');
    expect(getProductSpecFamily('Smartwatch Bands')).toBe('general');
    expect(getProductSpecFamily('Watch Straps')).toBe('general');
    expect(getProductSpecFamily('Screen Protectors')).toBe('general');
    expect(getProductSpecFamily('Gaming Grip')).toBe('general');
    expect(getProductSpecFamily('Camera Grip')).toBe('general');
  });

  it('does not apply camera-body projections to camera accessories', () => {
    for (const category of [
      'Lenses',
      'Microphones',
      'Camera Accessories',
      'instant-film',
      'memory-cards',
      'tripod-stands',
    ]) {
      expect(getProductSpecFamily(category)).toBe('general');
    }
  });

  it('covers mobile, computer, and undefined category fallbacks', () => {
    expect(getProductSpecFamily('Smartphones')).toBe('mobile');
    expect(getProductSpecFamily('Camera Phones')).toBe('mobile');
    expect(getProductSpecFamily('Pads')).toBe('mobile');
    expect(getProductSpecFamily('Laptops')).toBe('computer');
    expect(getProductSpecFamily('PCs')).toBe('computer');
    expect(getProductSpecFamily('PC')).toBe('computer');
    expect(getProductSpecFamily(undefined)).toBe('general');
  });

  it('normalizes google-pixel slugs without promoting genuine accessories', () => {
    expect(getProductSpecFamily('google-pixel')).toBe('mobile');
    expect(getProductSpecFamily('google_pixel')).toBe('mobile');
    expect(getProductSpecFamily('google-pixel-cases')).toBe('general');
    expect(getProductSpecFamily('google_pixel_accessories')).toBe('general');
  });

  it('classifies fitness trackers as mobile wearables', () => {
    expect(getProductSpecFamily('Fitness Trackers')).toBe('mobile');
  });

  it('treats controllers as accessory-like categories', () => {
    expect(isAccessoryLikeCategory('Controllers')).toBe(true);
    expect(getProductSpecFamily('Controllers')).toBe('general');
  });
});
