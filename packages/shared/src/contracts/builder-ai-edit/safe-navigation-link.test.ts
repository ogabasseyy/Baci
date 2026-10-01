import { describe, expect, it } from 'vitest';
import { safeNavigationLinkSchema } from './safe-navigation-link';

describe('safeNavigationLinkSchema', () => {
  it('accepts a bounded navigation link with a safe URL', () => {
    expect(
      safeNavigationLinkSchema.safeParse({ label: 'Shop', url: '/shop' })
        .success
    ).toBe(true);
  });

  it('rejects blank labels and unsafe URLs', () => {
    expect(
      safeNavigationLinkSchema.safeParse({ label: ' ', url: '/shop' }).success
    ).toBe(false);
    expect(
      safeNavigationLinkSchema.safeParse({
        label: 'Shop',
        url: 'javascript:alert(1)',
      }).success
    ).toBe(false);
  });
});
