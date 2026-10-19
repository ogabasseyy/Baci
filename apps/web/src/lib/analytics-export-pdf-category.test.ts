import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsData } from '@/components/analytics/analytics-grid-types';

const autoTableMock = vi.hoisted(() =>
  vi.fn((doc: { lastAutoTable?: { finalY: number } }) => {
    doc.lastAutoTable = { finalY: 50 };
  })
);

vi.mock('jspdf-autotable', () => ({ default: autoTableMock }));

import { appendAnalyticsCategoryPdfSection } from './analytics-export-pdf-category';

describe('appendAnalyticsCategoryPdfSection', () => {
  it('renders lifetime segment details into the PDF document', () => {
    const text = vi.fn();
    const doc = {
      lastAutoTable: undefined,
      setFontSize: vi.fn(),
      setTextColor: vi.fn(),
      text,
    };
    const data: AnalyticsData = {
      segmentSummary: {
        at_risk_count: 1,
        champions_count: 2,
        segments: [{ count: 2, segment: 'Champions' }],
        total_customers: 4,
      },
    };

    appendAnalyticsCategoryPdfSection(
      doc as never,
      data,
      'segments',
      20,
      (value) => `$${value.toFixed(2)}`
    );

    expect(text).toHaveBeenCalledWith('Customer Segments (Lifetime)', 14, 20);
    expect(autoTableMock).toHaveBeenCalled();
  });
});
