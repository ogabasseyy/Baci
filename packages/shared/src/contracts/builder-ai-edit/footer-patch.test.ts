import { describe, expect, it } from 'vitest';
import { footerPatchSchema } from './footer-patch';

describe('footerPatchSchema', () => {
  it('rejects duplicate quick-link labels before they can become React keys', () => {
    expect(
      footerPatchSchema.safeParse({
        componentType: 'Footer',
        quickLinks: [
          { label: 'Contact', url: '/contact' },
          { label: 'Contact', url: '/support' },
        ],
      }).success
    ).toBe(false);
  });

  it('accepts distinct bounded quick links', () => {
    expect(
      footerPatchSchema.safeParse({
        componentType: 'Footer',
        quickLinks: Array.from({ length: 8 }, (_, index) => ({
          label: `Link ${index}`,
          url: `/link-${index}`,
        })),
      }).success
    ).toBe(true);
  });

  it('rejects a ninth quick link', () => {
    expect(
      footerPatchSchema.safeParse({
        componentType: 'Footer',
        quickLinks: Array.from({ length: 9 }, (_, index) => ({
          label: `Link ${index}`,
          url: `/link-${index}`,
        })),
      }).success
    ).toBe(false);
  });

  it('rejects an empty Footer patch', () => {
    expect(
      footerPatchSchema.safeParse({ componentType: 'Footer' }).success
    ).toBe(false);
  });

  it('rejects a nested unsafe quick-link URL', () => {
    expect(
      footerPatchSchema.safeParse({
        componentType: 'Footer',
        quickLinks: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
      }).success
    ).toBe(false);
  });
});
