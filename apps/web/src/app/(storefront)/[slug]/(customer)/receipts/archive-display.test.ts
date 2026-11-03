import { describe, expect, it } from 'vitest';
import {
  formatArchiveDate,
  resolveArchiveDocumentKind,
} from '@/app/(storefront)/[slug]/(customer)/receipts/archive-display';
import type { StorefrontOrder } from '@/types/storefront-order';

describe('formatArchiveDate', () => {
  it('formats date-only values in UTC without day shift', () => {
    expect(formatArchiveDate('2024-02-05')).toBe('Feb 5, 2024');
  });

  it('formats timestamps in the document timezone like the PDFs', () => {
    // 23:30 UTC is already the next day in Lagos: the archive card must
    // agree with the emailed/downloaded PDFs, not the browser timezone.
    expect(formatArchiveDate('2024-02-04T23:30:00.000Z')).toBe('Feb 5, 2024');
    expect(formatArchiveDate('2024-02-05T10:00:00.000Z')).toBe('Feb 5, 2024');
  });

  it('degrades nullish and invalid values to a dash', () => {
    expect(formatArchiveDate(null)).toBe('-');
    expect(formatArchiveDate(undefined)).toBe('-');
    expect(formatArchiveDate('not-a-date')).toBe('-');
    expect(formatArchiveDate('2024-13-45')).toBe('-');
  });
});

describe('resolveArchiveDocumentKind', () => {
  it('passes receipts through untouched', () => {
    expect(
      resolveArchiveDocumentKind({
        current_document_kind: 'receipt',
      } as StorefrontOrder)
    ).toBe('receipt');
  });

  it('labels 325 invoice-method orders as proforma', () => {
    expect(
      resolveArchiveDocumentKind({
        current_document_kind: 'invoice',
        invoice_type_code: '325',
      } as StorefrontOrder)
    ).toBe('proforma');
  });

  it('defaults missing kinds to invoice', () => {
    expect(resolveArchiveDocumentKind({} as StorefrontOrder)).toBe('invoice');
    expect(
      resolveArchiveDocumentKind({
        current_document_kind: 'invoice',
        invoice_type_code: '380',
      } as StorefrontOrder)
    ).toBe('invoice');
  });
});
