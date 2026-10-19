import { describe, expect, it } from 'vitest';
import { isCameraLikeCategory } from './spec-camera-classifier';

describe('isCameraLikeCategory', () => {
  it('recognizes camera-body families and slug forms', () => {
    for (const category of [
      'Cameras',
      'Action Cameras',
      'instant-cameras',
      'Camcorders',
      'Dash Cams',
      'Cameras (DSLR)',
    ]) {
      expect(isCameraLikeCategory(category)).toBe(true);
    }
  });

  it('does not classify camera accessories as camera bodies', () => {
    for (const category of [
      'Camera Accessories',
      'instant-film',
      'memory-cards',
      'tripod-stands',
      'Lenses',
      'Microphones',
      'Camera Lenses',
      'Camera Batteries',
      'Camera Flashes',
    ]) {
      expect(isCameraLikeCategory(category)).toBe(false);
    }
  });

  it('does not classify ordinary device accessories as cameras', () => {
    expect(isCameraLikeCategory('Smartphone Cases')).toBe(false);
    expect(isCameraLikeCategory('Laptop Keyboard')).toBe(false);
  });

  it('does not classify mobile categories containing camera as cameras', () => {
    expect(isCameraLikeCategory('Camera Phones')).toBe(false);
    expect(isCameraLikeCategory('camera-phones')).toBe(false);
  });
});
