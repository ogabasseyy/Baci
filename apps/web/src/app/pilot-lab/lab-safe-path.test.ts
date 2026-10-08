import { describe, expect, it } from 'vitest';
import { isSafeRelativePath } from './lab-safe-path';

describe('isSafeRelativePath', () => {
  it('accepts ordinary relative snapshot paths', () => {
    expect(isSafeRelativePath('logo-1.png')).toBe(true);
    expect(isSafeRelativePath('nested/dir/photo.avif')).toBe(true);
    expect(isSafeRelativePath('a'.repeat(256))).toBe(true);
  });

  it('rejects empty and overlong inputs', () => {
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a'.repeat(257))).toBe(false);
  });

  it('rejects absolute paths and backslashes', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('..\\snapshot.png')).toBe(false);
    expect(isSafeRelativePath('dir\\file.png')).toBe(false);
  });

  it('rejects dot segments and empty segments', () => {
    expect(isSafeRelativePath('../escape.png')).toBe(false);
    expect(isSafeRelativePath('dir/../escape.png')).toBe(false);
    expect(isSafeRelativePath('./snapshot.png')).toBe(false);
    expect(isSafeRelativePath('dir//file.png')).toBe(false);
    expect(isSafeRelativePath('dir/..')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isSafeRelativePath('snap\0shot.png')).toBe(false);
    expect(isSafeRelativePath('snap\nshot.png')).toBe(false);
    expect(isSafeRelativePath('snap\x7fshot.png')).toBe(false);
  });

  it('rejects encoded separators at any decode layer', () => {
    expect(isSafeRelativePath('snap%2fshot.png')).toBe(false);
    expect(isSafeRelativePath('snap%5cshot.png')).toBe(false);
    expect(isSafeRelativePath('snap%00.png')).toBe(false);
    // Double-encoded: the intermediate %2f layer must still trip the check.
    expect(isSafeRelativePath('snap%252fshot.png')).toBe(false);
    expect(isSafeRelativePath('snap%25252fshot.png')).toBe(false);
  });

  it('rejects traversal smuggled through decoding', () => {
    expect(isSafeRelativePath('%2e%2e%2fsnapshot.png')).toBe(false);
    expect(isSafeRelativePath('dir%2f..%2fescape.png')).toBe(false);
  });

  it('validates malformed sequences as-is without throwing', () => {
    expect(isSafeRelativePath('snap%zzshot.png')).toBe(true);
    expect(isSafeRelativePath('100%.png')).toBe(true);
    expect(isSafeRelativePath('snap%.png')).toBe(true);
  });
});
