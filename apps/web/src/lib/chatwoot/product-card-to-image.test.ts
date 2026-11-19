import { describe, expect, it } from 'vitest';
import { toImage } from './product-card-to-image';

describe('toImage', () => {
  it('keeps only credential-free https images within the length limit', () => {
    expect(toImage('https://cdn.example.test/a.jpg')).toBe(
      'https://cdn.example.test/a.jpg'
    );
    expect(toImage({ url: 'https://cdn.example.test/b.jpg' })).toBe(
      'https://cdn.example.test/b.jpg'
    );
    expect(toImage('http://cdn.example.test/a.jpg')).toBeUndefined();
    expect(toImage('https://user:pw@cdn.example.test/a.jpg')).toBeUndefined();
    expect(toImage('not a url')).toBeUndefined();
    expect(toImage(`https://x.test/${'a'.repeat(2_100)}`)).toBeUndefined();
    expect(toImage(42)).toBeUndefined();
  });
});
