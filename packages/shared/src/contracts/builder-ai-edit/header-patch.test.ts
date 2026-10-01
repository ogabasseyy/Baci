import { describe, expect, it } from 'vitest';
import { headerPatchSchema } from './header-patch';

describe('headerPatchSchema', () => {
  it('rejects duplicate navigation labels before they can become React keys', () => {
    expect(
      headerPatchSchema.safeParse({
        componentType: 'Header',
        navigationLinks: [
          { label: 'Shop', url: '/shop' },
          { label: 'Shop', url: '/sale' },
        ],
      }).success
    ).toBe(false);
  });

  it('accepts distinct navigation labels and supported header options', () => {
    expect(
      headerPatchSchema.safeParse({
        componentType: 'Header',
        layout: 'logo-left-nav-center',
        navigationLinks: [
          { label: 'Shop', url: '/shop' },
          { label: 'Sale', url: '/sale' },
        ],
      }).success
    ).toBe(true);
  });
});
