import { describe, expect, it } from 'vitest';

import { getFirstAcceptedSpecValue } from './get-first-accepted-spec-value';

describe('getFirstAcceptedSpecValue', () => {
  it('retains positive camera measurements when category data is unavailable', () => {
    expect(getFirstAcceptedSpecValue({}, 'main_camera_mp', 50)).toBe(50);
  });

  it('does not bypass the category-aware policy when a category is known', () => {
    expect(
      getFirstAcceptedSpecValue({ category: 'Gaming' }, 'main_camera_mp', 50)
    ).toBeUndefined();
  });

  it('does not treat category-slug-only feed products as uncategorized', () => {
    expect(
      getFirstAcceptedSpecValue(
        { category_slug: 'phone-cases' },
        'main_camera_mp',
        50
      )
    ).toBeUndefined();
  });

  it('retains categoryless RAM and storage measurements for feed enrichment', () => {
    expect(getFirstAcceptedSpecValue({}, 'ram_gb', 12)).toBe(12);
    expect(getFirstAcceptedSpecValue({}, 'storage_gb', 256)).toBe(256);
    expect(
      getFirstAcceptedSpecValue({}, 'display_resolution', '2532 x 1170')
    ).toBe('2532 x 1170');
  });

  it('ignores placeholder categories when deciding categoryless feed fallback', () => {
    expect(
      getFirstAcceptedSpecValue({ category: 'Unknown' }, 'ram_gb', 12)
    ).toBe(12);
  });
});
