import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics-export', () => ({
  exportAnalyticsAsCSV: vi.fn(),
  exportAnalyticsAsPDF: vi.fn(),
}));

import { loadAnalyticsExport } from './load-analytics-export';

describe('loadAnalyticsExport', () => {
  it('loads both analytics export formats', async () => {
    await expect(loadAnalyticsExport()).resolves.toEqual(
      expect.objectContaining({
        exportAnalyticsAsCSV: expect.any(Function),
        exportAnalyticsAsPDF: expect.any(Function),
      })
    );
  });
});
