import { describe, expect, it, vi } from 'vitest';
import { isAnalyticsCategoryAllowed } from './analytics-category-permissions';

describe('isAnalyticsCategoryAllowed', () => {
  it('hides specialized categories whose backing resource cannot be viewed', () => {
    const hasPermission = vi.fn(() => false);

    expect(isAnalyticsCategoryAllowed('inventory', hasPermission)).toBe(false);
    expect(isAnalyticsCategoryAllowed('segments', hasPermission)).toBe(false);
    expect(isAnalyticsCategoryAllowed('overview', hasPermission)).toBe(true);
  });
});
