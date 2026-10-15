import { describe, expect, it } from 'vitest';
import { optionalHttpUrlSchema } from './order-create-fields';

describe('order optional image URL', () => {
  it.each([undefined, null, '', '   '])('treats %j as absent', (value) => {
    expect(optionalHttpUrlSchema.parse(value)).toBeUndefined();
  });
  it('keeps HTTP and HTTPS URLs', () => {
    expect(optionalHttpUrlSchema.parse(' https://example.com/image.png ')).toBe(
      'https://example.com/image.png'
    );
    expect(optionalHttpUrlSchema.parse('http://example.com/image.png')).toBe(
      'http://example.com/image.png'
    );
  });
  it.each([
    'javascript:alert(1)',
    'data:text/plain,x',
    'not a URL',
  ])('rejects %s', (value) => {
    expect(() => optionalHttpUrlSchema.parse(value)).toThrow();
  });
});
