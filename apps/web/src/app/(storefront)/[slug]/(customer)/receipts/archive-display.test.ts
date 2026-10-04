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

  it('formats timestamps with the local date formatter', () => {
    expect(formatArchiveDate('2024-02-05T10:00:00.000Z')).toMatch(
      /Feb \d, 2024/
    );
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
