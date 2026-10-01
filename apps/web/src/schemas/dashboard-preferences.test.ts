import { describe, expect, it } from 'vitest';
import { dashboardPreferencesSchema } from './dashboard-preferences';

describe('dashboardPreferencesSchema', () => {
  it('accepts a bounded responsive layout made from known widget ids', () => {
    const result = dashboardPreferencesSchema.safeParse({
      layout_config: {
        lg: [{ h: 3, i: 'ads-reporting', w: 12, x: 0, y: 4 }],
        sm: [{ h: 3, i: 'ads-reporting', w: 6, x: 0, y: 8 }],
      },
      visible_cards: ['ads-reporting', 'social-ads-reporting'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown widgets and oversized layouts', () => {
    expect(
      dashboardPreferencesSchema.safeParse({
        layout_config: [{ h: 1, i: 'untrusted-widget', w: 1, x: 0, y: 0 }],
      }).success
    ).toBe(false);
    expect(
      dashboardPreferencesSchema.safeParse({
        layout_config: Array.from({ length: 101 }, () => ({
          h: 1,
          i: 'ads-reporting',
          w: 1,
          x: 0,
          y: 0,
        })),
      }).success
    ).toBe(false);
    expect(
      dashboardPreferencesSchema.safeParse({
        layout_config: [{ h: 1, i: 'ads-reporting', w: 12, x: 1, y: 0 }],
      }).success
    ).toBe(false);
  });

  it('accepts layouts keyed by analytics category', () => {
    expect(
      dashboardPreferencesSchema.safeParse({
        layout_config: {
          ads: {
            lg: [{ h: 3, i: 'ads-reporting', w: 12, x: 0, y: 4 }],
          },
          inventory: {
            lg: [{ h: 2, i: 'inventory-summary', w: 6, x: 0, y: 0 }],
          },
        },
      }).success
    ).toBe(true);
  });
});
