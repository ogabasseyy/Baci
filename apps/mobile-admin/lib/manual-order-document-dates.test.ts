import { describe, expect, it } from 'vitest';
import { getManualOrderDocumentDates } from './manual-order-document-dates';

describe('getManualOrderDocumentDates', () => {
  it('returns the selected local calendar day for both document dates', () => {
    expect(getManualOrderDocumentDates(new Date(2026, 2, 5, 0, 30))).toEqual({
      invoice_issue_date: '2026-03-05',
      tax_point_date: '2026-03-05',
    });
  });

  it('rejects invalid dates before persisting document values', () => {
    expect(() => getManualOrderDocumentDates(new Date('invalid'))).toThrow(
      'Invalid order date'
    );
  });
});
