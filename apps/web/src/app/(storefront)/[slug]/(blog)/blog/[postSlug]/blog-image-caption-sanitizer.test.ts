import { describe, expect, it } from 'vitest';
import { sanitizeBlogImageCaptionText } from './blog-image-caption-sanitizer';

describe('sanitizeBlogImageCaptionText', () => {
  it('returns empty string for empty or whitespace-only input', () => {
    expect(sanitizeBlogImageCaptionText('')).toBe('');
    expect(sanitizeBlogImageCaptionText('   \n\t  ')).toBe('');
  });

  it('strips leaked AI prompt prefixes and capitalizes the remaining sentence', () => {
    expect(
      sanitizeBlogImageCaptionText(
        'Editorial illustration: compare flagship battery life.'
      )
    ).toBe('Compare flagship battery life.');
    expect(
      sanitizeBlogImageCaptionText(
        'Planned conceptual visual concept: inside the charging coil.'
      )
    ).toBe('Inside the charging coil.');
  });

  it('strips trailing guardrail instructions while preserving caption content', () => {
    expect(
      sanitizeBlogImageCaptionText(
        'Pixel 9 Pro camera bar. Use approved hardware references, no logos or watermarks.'
      )
    ).toBe('Pixel 9 Pro camera bar.');
    expect(
      sanitizeBlogImageCaptionText(
        'Keep screens free of readable text and omit logos.'
      )
    ).toBe('');
  });

  it('preserves brand casing when no prompt prefix was removed', () => {
    expect(sanitizeBlogImageCaptionText('iPhone 17 Pro in Titanium.')).toBe(
      'iPhone 17 Pro in Titanium.'
    );
  });

  it('bounds over-length captions and still strips leaked prompt prefixes', () => {
    const overLength = `Editorial illustration: ${'a'.repeat(1005)}`;
    const result = sanitizeBlogImageCaptionText(overLength);
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result.startsWith('A')).toBe(true);
    expect(result).not.toContain('Editorial illustration:');
  });
});
