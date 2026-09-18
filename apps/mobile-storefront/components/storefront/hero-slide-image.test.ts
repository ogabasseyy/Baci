import { describe, expect, it, jest } from '@jest/globals';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import {
  getCoverHeroImageSource,
  getHeroImageSource,
  heroImageProps,
} from './hero-slide-image';

jest.mock('@/lib/safe-bounded-image-source', () => ({
  createSafeBoundedImageSource: jest.fn((options: unknown) => ({
    options,
  })),
}));

const mockCreateSource = jest.mocked(createSafeBoundedImageSource);

describe('hero-slide-image', () => {
  it('exposes offline-caching image props', () => {
    // Arrange & Act & Assert
    expect(heroImageProps.cachePolicy).toBe('memory-disk');
    expect(heroImageProps.autoplay).toBe(false);
  });

  it('builds bounded sources with and without cover fit', () => {
    // Arrange & Act
    getHeroImageSource('https://example.com/a.jpg', 390, 220);
    getCoverHeroImageSource('https://example.com/b.jpg', 390, 450);

    // Assert
    expect(mockCreateSource).toHaveBeenNthCalledWith(1, {
      height: 220,
      uri: 'https://example.com/a.jpg',
      width: 390,
    });
    expect(mockCreateSource).toHaveBeenNthCalledWith(2, {
      fit: 'cover',
      height: 450,
      uri: 'https://example.com/b.jpg',
      width: 390,
    });
  });
});
