import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { queryClient } from '@/lib/query-client';
import { buildOrderReceiptMerchant } from './buildOrderReceiptMerchant';
import { paystackBanksQueryOptions } from './usePaystackBanks';

vi.mock('@/lib/query-client', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

const merchant = {
  id: 'merchant',
  bank_account_number: '1234567890',
  bank_code: 'new-bank',
};

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe('buildOrderReceiptMerchant', () => {
  it('shares one directory request across concurrent and repeated previews', async () => {
    vi.mocked(apiClient).mockResolvedValue({
      banks: [{ code: 'new-bank', name: 'Verified Bank' }],
    });
    const build = () =>
      buildOrderReceiptMerchant(merchant, null, undefined, true);
    const [first, second] = await Promise.all([build(), build()]);
    expect(first.bank_name).toBe('Verified Bank');
    expect(second.bank_name).toBe('Verified Bank');
    expect((await build()).bank_name).toBe('Verified Bank');
    expect(apiClient).toHaveBeenCalledOnce();
  });

  it('isolates the receipt request from the bank picker cache', async () => {
    vi.mocked(apiClient)
      .mockResolvedValueOnce({
        banks: [{ code: 'new-bank', name: 'Picker Bank' }],
      })
      .mockResolvedValueOnce({
        banks: [{ code: 'new-bank', name: 'Receipt Bank' }],
      });
    const pickerOptions = paystackBanksQueryOptions();
    await queryClient.fetchQuery(pickerOptions);

    const result = await buildOrderReceiptMerchant(
      merchant,
      null,
      undefined,
      true
    );

    expect(result.bank_name).toBe('Receipt Bank');
    expect(queryClient.getQueryData(pickerOptions.queryKey)).toEqual([
      { code: 'new-bank', name: 'Picker Bank' },
    ]);
  });

  it('does not invent a bank name for an unmatched code', async () => {
    vi.mocked(apiClient).mockResolvedValue({ banks: [] });
    const result = await buildOrderReceiptMerchant(
      { ...merchant, bank_code: 'unmatched' },
      null,
      undefined,
      true
    );
    expect(result.bank_name).toBe('');
    expect(result.bank_account_number).toBe(merchant.bank_account_number);
  });

  it('leaves an unresolved name unset when the directory fails', async () => {
    const options = paystackBanksQueryOptions(3000);
    queryClient.setQueryData(
      options.queryKey,
      [{ code: merchant.bank_code, name: 'Old Bank' }],
      { updatedAt: Date.now() - options.staleTime - 1 }
    );
    vi.mocked(apiClient).mockRejectedValue(new Error('offline'));
    const result = await buildOrderReceiptMerchant(
      merchant,
      null,
      undefined,
      true
    );
    expect(result.bank_name).toBe('');
  });

  it.each([
    [{ ...merchant, bank_name: 'Stored Bank' }, true],
    [{ ...merchant, bank_code: '058' }, true],
    [{ ...merchant, bank_account_number: null }, true],
    [merchant, false],
  ] as const)('skips directory lookup when it cannot change the payment instructions', async (input, showInstructions) => {
    await buildOrderReceiptMerchant(input, null, undefined, showInstructions);
    expect(apiClient).not.toHaveBeenCalled();
  });
});
