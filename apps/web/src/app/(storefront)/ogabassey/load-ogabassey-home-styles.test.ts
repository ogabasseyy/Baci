import { describe, expect, it, vi } from 'vitest';
import { loadOgabasseyHomeStyles } from './load-ogabassey-home-styles';

const { mockCoreCssImport, mockHomeCssImport } = vi.hoisted(() => ({
  mockCoreCssImport: vi.fn(),
  mockHomeCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-core.css', () => {
  mockCoreCssImport();
  return {};
});
vi.mock('@/app/(storefront)/storefront-home.css', () => {
  mockHomeCssImport();
  return {};
});

describe('loadOgabasseyHomeStyles', () => {
  it('imports core and home stylesheets together', async () => {
    await loadOgabasseyHomeStyles();

    expect(mockCoreCssImport).toHaveBeenCalled();
    expect(mockHomeCssImport).toHaveBeenCalled();
  });
});
