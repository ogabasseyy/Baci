import { createSafeBoundedImageSource } from './safe-bounded-image-source';

describe('createSafeBoundedImageSource', () => {
  it('rewrites managed AVIF product assets to a bounded static WebP', () => {
    expect(
      createSafeBoundedImageSource({
        height: 100,
        pixelRatio: 2,
        uri: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        width: 120,
      })
    ).toEqual({
      height: 200,
      uri: 'https://cdn.ogabassey.com/image/width=240,height=200,quality=82,format=webp/core-assets/products/phone.avif',
      width: 240,
    });
  });

  it('forwards cover fitting to managed CDN transforms', () => {
    expect(
      createSafeBoundedImageSource({
        fit: 'cover',
        height: 100,
        uri: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        width: 120,
      }).uri
    ).toBe(
      'https://cdn.ogabassey.com/image/width=240,height=200,quality=82,format=webp,fit=cover/core-assets/products/phone.avif'
    );
  });

  it('keeps unmanaged image URLs unchanged while bounding decode dimensions', () => {
    // Arrange
    const source = {
      height: 80,
      pixelRatio: 2,
      uri: 'https://images.example.com/products/phone.png',
      width: 100,
    };

    // Act
    const result = createSafeBoundedImageSource(source);

    // Assert
    expect(result).toEqual({
      height: 160,
      uri: source.uri,
      width: 200,
    });
  });
});
