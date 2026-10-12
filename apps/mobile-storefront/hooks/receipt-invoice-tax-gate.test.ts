import { describe, expect, it, jest } from '@jest/globals';
import { withSupabaseRetry } from '@/lib/api';
import { isReceiptInvoiceTaxValid } from './receipt-invoice-tax-gate';

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: jest.fn(),
}));

const retry = jest.mocked(withSupabaseRetry);

describe('isReceiptInvoiceTaxValid', () => {
  it('accepts valid subtotal rows', async () => {
    retry.mockResolvedValueOnce({
      data: [{ vat_rate: 7.5, taxable_amount: 100, tax_amount: 7.5 }],
      error: null,
    } as never);
    await expect(isReceiptInvoiceTaxValid('order-1')).resolves.toBe(true);
  });

  it('accepts rowless orders like the sender synthesis path', async () => {
    retry.mockResolvedValueOnce({ data: [], error: null } as never);
    await expect(isReceiptInvoiceTaxValid('order-1')).resolves.toBe(true);
  });

  it('rejects negative money in any subtotal', async () => {
    retry.mockResolvedValueOnce({
      data: [{ vat_rate: -1, taxable_amount: 100, tax_amount: 7.5 }],
      error: null,
    } as never);
    await expect(isReceiptInvoiceTaxValid('order-1')).resolves.toBe(false);
  });

  it('rejects corrupt payloads instead of exposing the preview', async () => {
    retry.mockResolvedValueOnce({ data: { nope: 1 }, error: null } as never);
    await expect(isReceiptInvoiceTaxValid('order-1')).resolves.toBe(false);
  });

  it('throws when the lookup fails so the load fails closed', async () => {
    retry.mockResolvedValueOnce({
      data: null,
      error: new Error('boom'),
    } as never);
    await expect(isReceiptInvoiceTaxValid('order-1')).rejects.toThrow('boom');
  });
});
