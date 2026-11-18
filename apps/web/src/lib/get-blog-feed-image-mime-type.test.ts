import { describe, expect, it } from 'vitest';
import { getImageMimeType } from './get-blog-feed-image-mime-type';

describe('getImageMimeType', () => {
  it('maps image file extensions and CDN format transforms to valid IANA media types', () => {
    expect(getImageMimeType('https://cdn.example.com/photo.jpg')).toBe(
      'image/jpeg'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.jpeg')).toBe(
      'image/jpeg'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.png')).toBe(
      'image/png'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.webp')).toBe(
      'image/webp'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.avif')).toBe(
      'image/avif'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.gif')).toBe(
      'image/gif'
    );
    expect(getImageMimeType('https://cdn.example.com/photo.svg')).toBe(
      'image/svg+xml'
    );
    expect(
      getImageMimeType(
        'https://cdn.example.com/cdn-cgi/image/width=800,format=webp/photo.jpg'
      )
    ).toBe('image/webp');
    expect(
      getImageMimeType('https://cdn.example.com/image/format=avif/photo.jpg')
    ).toBe('image/avif');
    expect(
      getImageMimeType('https://cdn.example.com/photo.jpg?format=png')
    ).toBe('image/png');
  });

  it('returns undefined when media type is indeterminate or conflicting', () => {
    expect(
      getImageMimeType(
        'https://cdn.example.com/cdn-cgi/image/width=800,format=auto/photo.jpg'
      )
    ).toBeUndefined();
    expect(
      getImageMimeType(
        'https://cdn.example.com/cdn-cgi/image/width=800,format=auto/photo.jpg?format=png'
      )
    ).toBeUndefined();
    expect(
      getImageMimeType(
        'https://cdn.example.com/cdn-cgi/image/format=webp/photo.jpg?format=png'
      )
    ).toBeUndefined();
    expect(
      getImageMimeType('https://cdn.example.com/photo.unknown')
    ).toBeUndefined();
    expect(
      getImageMimeType('https://cdn.example.com/photo.constructor')
    ).toBeUndefined();
    expect(
      getImageMimeType('https://cdn.example.com/photo.__proto__')
    ).toBeUndefined();
    expect(getImageMimeType('https://cdn.example.com/photo')).toBeUndefined();
    expect(getImageMimeType('not-a-valid-url')).toBeUndefined();
  });
});
