import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';

type QueryOptions = {
  enabled?: boolean;
  queryFn: () => Promise<unknown>;
};

type SupabaseSingleResponse = {
  data: unknown;
  error: Error | null;
};

const mockUseQuery = jest.fn((options: unknown) => options);
const mockWithSupabaseRetry = jest.fn(
  async (callback: () => Promise<unknown>) => callback()
);
const mockFrom = jest.fn((_table: string) => ({}));
const mockReceiptRpcMaybeSingle =
  jest.fn<() => Promise<SupabaseSingleResponse>>();
const mockRpc = jest.fn((_fn: string, _args: unknown) => ({
  maybeSingle: mockReceiptRpcMaybeSingle,
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}));

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (callback: () => Promise<unknown>) =>
    mockWithSupabaseRetry(callback),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

describe('useMerchantReceiptInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads receipt merchant info via the bounded RPC, not a raw merchants select', async () => {
    const { useMerchantReceiptInfo } = await import(
      '@/hooks/use-merchant-receipt-info'
    );
    mockReceiptRpcMaybeSingle.mockResolvedValue({
      data: {
        business_name: 'OgaBassey',
        logo_url: null,
        email: 'support@example.com',
        phone: null,
        support_email: null,
        support_phone: null,
        business_address: null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: { primary: '#111111', accent: '#222222' },
        vat_registration_status: null,
        vat_rate: null,
        bank_code: null,
        bank_name: 'Test Bank',
        bank_account_number: '0123456789',
        bank_account_name: 'OgaBassey Ltd',
        social_media: null,
        pages: null,
      },
      error: null,
    });

    function Probe() {
      useMerchantReceiptInfo();
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;
    const info = (await options.queryFn()) as {
      bank_account_number: string;
      brand_colors: unknown;
    };

    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_receipt_merchant_info',
      { p_slug: 'ogabassey' }
    );
    expect(mockReceiptRpcMaybeSingle).toHaveBeenCalledTimes(1);
    // Regression guard: bank/tax identity must NOT come from a raw anon
    // merchants table read (removed by S0-A).
    expect(mockFrom).not.toHaveBeenCalledWith('merchants');
    expect(info.bank_account_number).toBe('0123456789');
    expect(info.brand_colors).toEqual({
      primary: '#111111',
      accent: '#222222',
    });
  });

  it('rejects an invalid merchant receipt payload', async () => {
    const { useMerchantReceiptInfo } = await import(
      '@/hooks/use-merchant-receipt-info'
    );
    mockReceiptRpcMaybeSingle.mockResolvedValue({
      data: { business_name: 'Incomplete' },
      error: null,
    });

    function Probe() {
      useMerchantReceiptInfo();
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;

    await expect(options.queryFn()).rejects.toThrow();
  });

  it('throws when the RPC returns no merchant row', async () => {
    const { useMerchantReceiptInfo } = await import(
      '@/hooks/use-merchant-receipt-info'
    );
    mockReceiptRpcMaybeSingle.mockResolvedValue({ data: null, error: null });

    function Probe() {
      useMerchantReceiptInfo();
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;
    await expect(options.queryFn()).rejects.toThrow('Merchant not found');
  });
});
