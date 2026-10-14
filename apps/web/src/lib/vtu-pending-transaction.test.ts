import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKudaDataPlanCacheForTests } from '@/lib/kuda-data-plans';
import { preparePendingVtuTransaction } from '@/lib/vtu-pending-transaction';

const {
  mockFormatPhoneNumber,
  mockIsValidPhoneNumber,
  mockGenerateRequestRef,
  mockGetDataProviders,
  mockGetMonnifyBillers,
  mockGetMonnifyBillerProducts,
  mockVerifyMonnifyBillCustomer,
  mockLoggerWarn,
  mockCalculateCommerce,
  mockGetCurrentSlugForAliasStrict,
} = vi.hoisted(() => ({
  mockFormatPhoneNumber: vi.fn((value: string) => value),
  mockIsValidPhoneNumber: vi.fn(() => true),
  mockGenerateRequestRef: vi.fn(() => 'VTU-REF-123'),
  mockGetDataProviders: vi.fn(),
  mockGetMonnifyBillers: vi.fn(),
  mockGetMonnifyBillerProducts: vi.fn(),
  mockVerifyMonnifyBillCustomer: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockCalculateCommerce: vi.fn(() =>
    Promise.resolve({
      merchantEarning: 10,
      platformEarning: 5,
    })
  ),
  mockGetCurrentSlugForAliasStrict: vi.fn(),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
  getCurrentSlugForAliasStrict: mockGetCurrentSlugForAliasStrict,
}));

vi.mock('@/lib/kuda', () => ({
  NetworkProvider: {
    MTN: 'MTN',
    AIRTEL: 'AIRTEL',
    GLO: 'GLO',
    MOBILE_9: '9MOBILE',
  },
  formatPhoneNumber: mockFormatPhoneNumber,
  isValidPhoneNumber: mockIsValidPhoneNumber,
  generateRequestRef: () => mockGenerateRequestRef(),
  getDataProviders: () => mockGetDataProviders(),
}));

vi.mock('@/lib/supabase/client', () => ({
  calculateCommerce: mockCalculateCommerce,
}));

vi.mock('@/lib/monnify-bills', () => ({
  getCachedBillers: (...args: unknown[]) => mockGetMonnifyBillers(...args),
  getCachedBillerProducts: (...args: unknown[]) =>
    mockGetMonnifyBillerProducts(...args),
  getBillers: (...args: unknown[]) => mockGetMonnifyBillers(...args),
  getBillerProducts: (...args: unknown[]) =>
    mockGetMonnifyBillerProducts(...args),
  verifyBillCustomer: (...args: unknown[]) =>
    mockVerifyMonnifyBillCustomer(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

type PrepareSupabase = Parameters<
  typeof preparePendingVtuTransaction
>[0]['supabase'];

function createMockSupabase({
  merchant = {},
  settings = {},
  customer = {},
  insertRow = {},
}: {
  customer?: Record<string, unknown>;
  insertRow?: Record<string, unknown>;
  merchant?: Record<string, unknown>;
  settings?: Record<string, unknown>;
} = {}) {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'OgaBassey',
      paystack_subaccount_code: null,
      ...merchant,
    },
    error: null,
  });
  const settingsSingle = vi.fn().mockResolvedValue({
    data: {
      vtu_enabled: true,
      vtu_airtime_enabled: true,
      paystack_enabled: true,
      korapay_enabled: true,
      ...settings,
    },
    error: null,
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'customer-1',
      email: 'customer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '08012345678',
      user_id: 'user-1',
      ...customer,
    },
    error: null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'vtu-1',
      amount: 1000,
      customer_identifier: null,
      metadata: {},
      request_reference: 'VTU-REF-123',
      status: 'pending',
      type: 'airtime',
      ...insertRow,
    },
    error: null,
  });
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: insertSingle }),
  });

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            // The merchant lookup is alias-aware and uses .maybeSingle();
            // keep .single() too for any other caller. Same resolved value.
            eq: vi.fn().mockReturnValue({ single, maybeSingle: single }),
          }),
        };
      }
      if (table === 'merchant_feature_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ single: settingsSingle }),
          }),
        };
      }
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle }),
            }),
          }),
        };
      }
      return { insert };
    }),
  } as unknown as PrepareSupabase;

  return { insert, supabase };
}

function prepareAirtime(supabase: PrepareSupabase, networkProvider = 'mtn') {
  return preparePendingVtuTransaction({
    supabase,
    user: {
      id: 'user-1',
      email: 'customer@example.com',
    } as unknown as Parameters<typeof preparePendingVtuTransaction>[0]['user'],
    input: {
      merchantSlug: 'ogabassey',
      type: 'airtime',
      amount: 1000,
      phoneNumber: '08012345678',
      networkProvider,
      source: 'checkout',
    },
    source: 'checkout',
    requireCustomer: true,
  });
}

describe('preparePendingVtuTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKudaDataPlanCacheForTests();
    mockGetDataProviders.mockResolvedValue([]);
    mockGetMonnifyBillers.mockResolvedValue([
      {
        billerCategoryCode: 'AIRTIME',
        billerCode: 'MTN',
        categoryCodes: ['AIRTIME'],
        description: 'MTN',
        name: 'MTN',
      },
    ]);
    mockGetMonnifyBillerProducts.mockResolvedValue([
      {
        amount: null,
        billerCode: 'MTN',
        categoryCode: 'AIRTIME',
        fee: null,
        isAmountFixed: false,
        maxAmount: null,
        minAmount: 100,
        name: 'MTN Mobile Top up',
        productCode: '13',
      },
    ]);
    mockVerifyMonnifyBillCustomer.mockResolvedValue({
      verified: true,
      message: 'success',
      requireValidationRef: false,
    });
  });

  it('creates a pending VTU row with computed commissions', async () => {
    const { insert, supabase } = createMockSupabase({
      settings: {
        vtu_customer_cashback_enabled: true,
        vtu_customer_cashback_rate: 50,
      },
    });

    const result = await prepareAirtime(supabase);

    expect(result.requestReference).toBe('VTU-REF-123');
    expect(result.customerCashback).toBe(5);
    expect(result.effectiveMerchantEarning).toBe(5);
    expect(mockCalculateCommerce).toHaveBeenCalledWith('calculate_vtu', {
      amount: 1000,
      category: 'AIRTIME',
      merchantSplit: 50,
      provider: 'MTN',
      providerSource: 'monnify',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_identifier: '08012345678',
        metadata: expect.objectContaining({
          billerCode: 'MTN',
          productCode: '13',
          provider: 'monnify',
          // Marker-era flag (Codex R55 6rrU6H): unconditional, so the
          // unsubmitted proof never needs a deploy-coupled cutoff.
          submissionMarkerEra: true,
        }),
        network_provider: 'MTN',
      })
    );
  });

  it('uses percentage-based merchant commission rates without multiplying twice', async () => {
    const { supabase } = createMockSupabase({
      settings: { vtu_merchant_commission_rate: 50 },
    });

    const result = await prepareAirtime(supabase);

    expect(result.customerCashback).toBe(0);
    expect(result.effectiveMerchantEarning).toBe(10);
    expect(mockCalculateCommerce).toHaveBeenLastCalledWith('calculate_vtu', {
      amount: 1000,
      category: 'AIRTIME',
      merchantSplit: 50,
      provider: 'MTN',
      providerSource: 'monnify',
    });
  });

  it('throws when VTU is disabled for the merchant', async () => {
    const { supabase } = createMockSupabase({
      settings: { vtu_enabled: false },
    });

    await expect(prepareAirtime(supabase, 'MTN')).rejects.toThrow(
      'VTU is not enabled for this merchant'
    );
  });

  it('treats commission rate of 1 as 100% (not 1%)', async () => {
    // A stored merchant commission of `1` should mean "full commission"
    // (100%), matching how `100` is interpreted. Without the (0, 1] fix this
    // would be treated as 1% and merchantSplit would land at 1.
    mockCalculateCommerce.mockResolvedValueOnce({
      merchantEarning: 10,
      platformEarning: 5,
    });
    const { supabase: fractionalSupabase } = createMockSupabase({
      settings: { vtu_merchant_commission_rate: 1 },
    });
    const fractionalResult = await prepareAirtime(fractionalSupabase);

    expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
      'calculate_vtu',
      expect.objectContaining({ merchantSplit: 100 })
    );

    mockCalculateCommerce.mockResolvedValueOnce({
      merchantEarning: 10,
      platformEarning: 5,
    });
    const { supabase: percentSupabase } = createMockSupabase({
      settings: { vtu_merchant_commission_rate: 100 },
    });
    const percentResult = await prepareAirtime(percentSupabase);

    expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
      'calculate_vtu',
      expect.objectContaining({ merchantSplit: 100 })
    );
    expect(fractionalResult.effectiveMerchantEarning).toBe(
      percentResult.effectiveMerchantEarning
    );
  });

  it('persists customerName from the input as the row customer_name', async () => {
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 2000,
        billerName: 'EKEDC NG',
        billItemIdentifier: 'KUD-ELE-EKED-001',
        customerIdentifier: '43901766923',
        customerName: 'JANE METER-OWNER',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ customer_name: 'JANE METER-OWNER' })
    );
  });

  it('writes the client-supplied customerAddress to metadata for Kuda-routed bills', async () => {
    // Kuda non-telco path: no Monnify validation runs, so the client-supplied
    // address is the only source and must still be persisted to metadata.
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 2000,
        provider: 'kuda' as const,
        billerName: 'EKEDC NG',
        billItemIdentifier: 'KUD-ELE-EKED-001',
        customerIdentifier: '43901766923',
        customerName: 'JANE METER-OWNER',
        customerAddress: '5 Marina Road, Lagos',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ address: '5 Marina Road, Lagos' }),
      })
    );
  });

  it('persists Monnify checkout provider fields in transaction metadata', async () => {
    mockGetMonnifyBillerProducts.mockResolvedValueOnce([
      {
        amount: null,
        billerCode: 'biller1',
        categoryCode: 'ELECTRICITY',
        fee: null,
        isAmountFixed: false,
        maxAmount: 5000,
        minAmount: 100,
        name: 'Product 1',
        productCode: 'product1',
      },
    ]);
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 2000,
        provider: 'monnify' as const,
        billerCode: 'biller1',
        productCode: 'product1',
        validationReference: 'val-ref-123',
        requireValidationRef: true,
        customerIdentifier: '43901766923',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          provider: 'monnify',
          validationReference: 'val-ref-123',
          billerCode: 'biller1',
          productCode: 'product1',
          requireValidationRef: true,
        }),
      })
    );
  });

  it('rejects Monnify bill payments below the provider minimum before creating a row', async () => {
    mockGetMonnifyBillerProducts.mockResolvedValueOnce([
      {
        amount: null,
        billerCode: 'IKEDC',
        categoryCode: 'ELECTRICITY',
        fee: null,
        isAmountFixed: false,
        maxAmount: 100_000,
        minAmount: 1000,
        name: 'Ikeja Prepaid',
        productCode: 'IKEDC_PREPAID',
      },
    ]);
    const { insert, supabase } = createMockSupabase();

    await expect(
      preparePendingVtuTransaction({
        supabase,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['user'],
        input: {
          merchantSlug: 'ogabassey',
          type: 'electricity',
          amount: 500,
          provider: 'monnify' as const,
          billerCode: 'IKEDC',
          productCode: 'IKEDC_PREPAID',
          customerIdentifier: '43901766923',
          source: 'checkout',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['input'],
        source: 'checkout',
        requireCustomer: true,
      })
    ).rejects.toThrow('Minimum amount for Ikeja Prepaid is 1000');

    expect(insert).not.toHaveBeenCalled();
  });

  it('obtains missing Monnify validation references before creating a bill payment row', async () => {
    mockGetMonnifyBillerProducts.mockResolvedValueOnce([
      {
        amount: null,
        billerCode: 'IKEDC',
        categoryCode: 'ELECTRICITY',
        fee: null,
        isAmountFixed: false,
        maxAmount: 100_000,
        minAmount: 100,
        name: 'Ikeja Prepaid',
        productCode: 'IKEDC_PREPAID',
      },
    ]);
    mockVerifyMonnifyBillCustomer.mockResolvedValueOnce({
      verified: true,
      message: 'success',
      customerName: 'Meter Owner',
      requireValidationRef: true,
      validationReference: 'VAL-123',
    });
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 2000,
        provider: 'monnify' as const,
        billerCode: 'IKEDC',
        productCode: 'IKEDC_PREPAID',
        customerIdentifier: '43901766923',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(mockVerifyMonnifyBillCustomer).toHaveBeenCalledWith(
      'IKEDC',
      'IKEDC_PREPAID',
      '43901766923'
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: 'Meter Owner',
        metadata: expect.objectContaining({
          provider: 'monnify',
          validationReference: 'VAL-123',
          requireValidationRef: true,
        }),
      })
    );
  });

  it('prefers the server-validated name and address over client-supplied fields', async () => {
    mockGetMonnifyBillerProducts.mockResolvedValueOnce([
      {
        amount: null,
        billerCode: 'IKEDC',
        categoryCode: 'ELECTRICITY',
        fee: null,
        isAmountFixed: false,
        maxAmount: 100_000,
        minAmount: 100,
        name: 'Ikeja Prepaid',
        productCode: 'IKEDC_PREPAID',
      },
    ]);
    mockVerifyMonnifyBillCustomer.mockResolvedValueOnce({
      verified: true,
      message: 'success',
      customerName: 'Meter Owner',
      address: '5 Server-Validated Street',
      requireValidationRef: true,
      validationReference: 'VAL-123',
    });
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 2000,
        provider: 'monnify' as const,
        billerCode: 'IKEDC',
        productCode: 'IKEDC_PREPAID',
        customerIdentifier: '43901766923',
        // Client sends the buyer's own name/address (e.g. web checkout) — the
        // authoritative validate-customer result must win for both fields.
        customerName: 'Buyer Profile Name',
        customerAddress: 'Client-Supplied Address',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: 'Meter Owner',
        metadata: expect.objectContaining({
          address: '5 Server-Validated Street',
        }),
      })
    );
  });

  it('stores the real buyer phone on non-telco VTU rows and keeps the meter as customer_identifier', async () => {
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'electricity',
        amount: 1000,
        billerName: 'EKEDC NG',
        billItemIdentifier: 'KUD-ELE-EKED-002',
        customerIdentifier: '43901766923',
        customerPhone: '08146978921',
        source: 'checkout',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['input'],
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_identifier: '43901766923',
        phone_number: '08146978921',
        metadata: expect.objectContaining({
          customerPhone: '08146978921',
        }),
      })
    );
  });

  it('falls back to null customer_name when input has none', async () => {
    const { insert, supabase } = createMockSupabase();

    await prepareAirtime(supabase);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ customer_name: null })
    );
  });

  it('stores the resolved Kuda data package code for legacy provider UUID data payloads', async () => {
    mockGetDataProviders.mockResolvedValueOnce([
      {
        billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
        billerName: 'MTN',
        billerType: 'Internet Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
        billItems: [
          {
            amount: 3500,
            isAmountFixed: true,
            itemCode: 'MTN-35GB-MONTHLY',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'MTN 3.5GB Monthly',
          },
        ],
      },
    ]);
    const { insert, supabase } = createMockSupabase();

    await preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'data',
        amount: 3500,
        phoneNumber: '08142236698',
        networkProvider: 'mtn',
        dataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
        source: 'checkout',
      },
      source: 'checkout',
      requireCustomer: true,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3500,
        metadata: expect.objectContaining({
          dataPlanAmount: 3500,
          dataPlanCode: 'MTN-35GB-MONTHLY',
          dataPlanIsAmountFixed: true,
          dataPlanName: 'MTN 3.5GB Monthly',
          originalDataPlanCode: '2082751a-89c7-4862-86c5-5498194b32f3',
        }),
      })
    );
    expect(mockCalculateCommerce).toHaveBeenCalledWith(
      'calculate_vtu',
      expect.objectContaining({ amount: 3500 })
    );
  });

  it('rejects stale client amounts for exact fixed-price data package codes', async () => {
    mockGetDataProviders.mockResolvedValueOnce([
      {
        billerId: '2082751a-89c7-4862-86c5-5498194b32f3',
        billerName: 'MTN',
        billerType: 'Internet Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
        billItems: [
          {
            amount: 3500,
            isAmountFixed: true,
            itemCode: 'MTN-35GB-MONTHLY',
            itemCurrencySymbol: 'NGN',
            itemFee: 0,
            itemName: 'MTN 3.5GB Monthly',
          },
        ],
      },
    ]);
    const { insert, supabase } = createMockSupabase();

    await expect(
      preparePendingVtuTransaction({
        supabase,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['user'],
        input: {
          merchantSlug: 'ogabassey',
          type: 'data',
          amount: 100,
          phoneNumber: '08142236698',
          networkProvider: 'mtn',
          dataPlanCode: 'MTN-35GB-MONTHLY',
          source: 'checkout',
        },
        source: 'checkout',
        requireCustomer: true,
      })
    ).rejects.toThrow(
      'Data bundle amount changed for MTN 3.5GB Monthly. Please refresh data bundles and select a package.'
    );

    expect(mockCalculateCommerce).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  describe('paymentSplit metadata (Phase B.4)', () => {
    // Phase B.4 contract: when walletAmount > 0, write
    //   metadata.paymentSplit = { wallet: walletAmount, card: amount - walletAmount }
    // INCLUDING the wallet-only case (walletAmount === amount → card: 0).
    // Phase B.5's debit hook gates on `paymentSplit.wallet > 0`, so
    // wallet-only flows MUST set the field to trigger the debit.
    function prepareWithWalletAmount(
      supabase: PrepareSupabase,
      walletAmount: number | undefined
    ) {
      return preparePendingVtuTransaction({
        supabase,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['user'],
        input: {
          merchantSlug: 'ogabassey',
          type: 'airtime',
          amount: 1000,
          phoneNumber: '08012345678',
          networkProvider: 'mtn',
          source: 'checkout',
          ...(walletAmount !== undefined && { walletAmount }),
        },
        source: 'checkout',
        requireCustomer: true,
      });
    }

    it('writes paymentSplit { wallet, card } for hybrid (0 < walletAmount < amount)', async () => {
      const { insert, supabase } = createMockSupabase();
      await prepareWithWalletAmount(supabase, 300);

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            paymentSplit: { wallet: 300, card: 700 },
          }),
        })
      );
    });

    it('writes paymentSplit { wallet: amount, card: 0 } for wallet-only coverage', async () => {
      // Critical for Phase B.5: fulfillment gates the wallet debit on
      // paymentSplit.wallet > 0. Wallet-only must still write the field so
      // the debit fires.
      const { insert, supabase } = createMockSupabase();
      await prepareWithWalletAmount(supabase, 1000);

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            paymentSplit: { wallet: 1000, card: 0 },
          }),
        })
      );
    });

    it('does NOT write paymentSplit when walletAmount is 0 or absent (card-only)', async () => {
      const { insert, supabase } = createMockSupabase();
      await prepareWithWalletAmount(supabase, undefined);

      const insertCall = insert.mock.calls[0]?.[0] as
        | { metadata?: Record<string, unknown> }
        | undefined;
      expect(insertCall?.metadata).not.toHaveProperty('paymentSplit');

      insert.mockClear();
      await prepareWithWalletAmount(supabase, 0);
      const zeroCall = insert.mock.calls[0]?.[0] as
        | { metadata?: Record<string, unknown> }
        | undefined;
      expect(zeroCall?.metadata).not.toHaveProperty('paymentSplit');
    });

    it('does NOT write paymentSplit for non-checkout sources even when walletAmount > 0', async () => {
      // Defense in depth alongside the schema check. The schema
      // already rejects walletAmount > 0 on non-checkout sources at
      // the API boundary, but the prepare step also gates the
      // metadata write so a bypass (manual SQL, future code path) can
      // never strand a wallet debit on a non-checkout row.
      const { insert, supabase } = createMockSupabase();
      await preparePendingVtuTransaction({
        supabase,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['user'],
        input: {
          merchantSlug: 'ogabassey',
          type: 'airtime',
          amount: 1000,
          phoneNumber: '08012345678',
          networkProvider: 'mtn',
          source: 'loyalty_reward',
          walletAmount: 1000,
        },
        source: 'loyalty_reward',
        requireCustomer: true,
      });
      const insertCall = insert.mock.calls[0]?.[0] as
        | { metadata?: Record<string, unknown> }
        | undefined;
      expect(insertCall?.metadata).not.toHaveProperty('paymentSplit');
    });

    describe('provider routing and validation constraints', () => {
      it('throws when explicit provider is monnify but monnify fields are missing', async () => {
        const { supabase } = createMockSupabase();
        await expect(
          preparePendingVtuTransaction({
            supabase,
            user: {
              id: 'user-1',
              email: 'customer@example.com',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['user'],
            input: {
              merchantSlug: 'ogabassey',
              type: 'electricity',
              amount: 2000,
              provider: 'monnify',
              source: 'checkout',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['input'],
            source: 'checkout',
          })
        ).rejects.toThrow('Required Monnify fields are missing');
      });

      it('throws when explicit provider is kuda but kuda fields are missing', async () => {
        const { supabase } = createMockSupabase();
        await expect(
          preparePendingVtuTransaction({
            supabase,
            user: {
              id: 'user-1',
              email: 'customer@example.com',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['user'],
            input: {
              merchantSlug: 'ogabassey',
              type: 'electricity',
              amount: 2000,
              provider: 'kuda',
              source: 'checkout',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['input'],
            source: 'checkout',
          })
        ).rejects.toThrow('Required Kuda fields are missing');
      });

      it('prices explicit Kuda bill payments with the Kuda bill item key', async () => {
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'electricity',
            amount: 2000,
            provider: 'kuda',
            billItemIdentifier: 'kuda-bedc-prepaid',
            billerCode: 'BEDC',
            productCode: 'BEDC-PREPAID',
            customerIdentifier: '12345678',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'kuda',
            }),
          })
        );
        expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
          'calculate_vtu',
          expect.objectContaining({
            category: 'ELECTRICITY',
            provider: 'kuda-bedc-prepaid',
            providerSource: 'kuda',
          })
        );
      });

      it('prices explicit Monnify bill payments with the Monnify biller key', async () => {
        mockGetMonnifyBillerProducts.mockResolvedValueOnce([
          {
            amount: null,
            billerCode: 'BEDC',
            categoryCode: 'ELECTRICITY',
            fee: null,
            isAmountFixed: false,
            maxAmount: 100_000,
            minAmount: 100,
            name: 'BEDC Prepaid',
            productCode: 'BEDC-PREPAID',
          },
        ]);
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'electricity',
            amount: 2000,
            provider: 'monnify',
            billItemIdentifier: 'kuda-bedc-prepaid',
            billerCode: 'BEDC',
            productCode: 'BEDC-PREPAID',
            customerIdentifier: '12345678',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              billerCode: 'BEDC',
              productCode: 'BEDC-PREPAID',
              provider: 'monnify',
            }),
          })
        );
        expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
          'calculate_vtu',
          expect.objectContaining({
            category: 'ELECTRICITY',
            provider: 'BEDC',
            providerSource: 'monnify',
          })
        );
      });

      it('routes to Kuda when provider is omitted and only Kuda fields are present (even if routing prefers Monnify)', async () => {
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'electricity',
            amount: 2000,
            billItemIdentifier: 'bedc-prepaid',
            customerIdentifier: '12345678',
            billerName: 'BEDC',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'kuda',
            }),
          })
        );
      });

      it('routes to Monnify when provider is omitted and only Monnify fields are present (even if routing prefers Kuda)', async () => {
        mockGetMonnifyBillerProducts.mockResolvedValueOnce([
          {
            amount: null,
            billerCode: 'IBEDC',
            categoryCode: 'ELECTRICITY',
            fee: null,
            isAmountFixed: false,
            maxAmount: 100_000,
            minAmount: 100,
            name: 'IBEDC Prepaid',
            productCode: 'IBEDC-PREPAID',
          },
        ]);
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'electricity',
            amount: 2000,
            billerCode: 'IBEDC',
            productCode: 'IBEDC-PREPAID',
            customerIdentifier: '12345678',
            billerName: 'IBEDC',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'monnify',
              billerCode: 'IBEDC',
              productCode: 'IBEDC-PREPAID',
            }),
          })
        );
      });

      it('routes and prices as Kuda when provider is omitted, both field sets exist, and Kuda is preferred', async () => {
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'cable_tv',
            amount: 5000,
            billItemIdentifier: 'dstv-compact',
            billerCode: 'DSTV',
            productCode: 'DSTV-COMPACT',
            customerIdentifier: '12345678',
            billerName: 'DSTV',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'kuda',
            }),
          })
        );
        expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
          'calculate_vtu',
          expect.objectContaining({
            category: 'CABLE',
            provider: 'dstv-compact',
            providerSource: 'kuda',
          })
        );
      });

      it('routes and prices as Monnify when provider is omitted, both field sets exist, and Monnify is preferred', async () => {
        mockGetMonnifyBillerProducts.mockResolvedValueOnce([
          {
            amount: null,
            billerCode: 'BEDC',
            categoryCode: 'ELECTRICITY',
            fee: null,
            isAmountFixed: false,
            maxAmount: 100_000,
            minAmount: 100,
            name: 'BEDC Prepaid',
            productCode: 'BEDC-PREPAID',
          },
        ]);
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'electricity',
            amount: 2000,
            billItemIdentifier: 'bedc-prepaid',
            billerCode: 'BEDC',
            productCode: 'BEDC-PREPAID',
            customerIdentifier: '12345678',
            billerName: 'BEDC',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              provider: 'monnify',
              billerCode: 'BEDC',
              productCode: 'BEDC-PREPAID',
            }),
          })
        );
        expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
          'calculate_vtu',
          expect.objectContaining({
            category: 'ELECTRICITY',
            provider: 'BEDC',
            providerSource: 'monnify',
          })
        );
      });

      it('routes explicit Monnify airtime through validated Monnify product metadata', async () => {
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'airtime',
            amount: 1000,
            phoneNumber: '08012345678',
            networkProvider: 'mtn',
            provider: 'monnify',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(mockGetMonnifyBillers).toHaveBeenCalledWith('AIRTIME');
        expect(mockGetMonnifyBillerProducts).toHaveBeenCalledWith('MTN');
        expect(mockVerifyMonnifyBillCustomer).toHaveBeenCalledWith(
          'MTN',
          '13',
          '08012345678'
        );
        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            customer_identifier: '08012345678',
            metadata: expect.objectContaining({
              billerCode: 'MTN',
              productCode: '13',
              provider: 'monnify',
              requireValidationRef: false,
            }),
          })
        );
        expect(mockCalculateCommerce).toHaveBeenLastCalledWith(
          'calculate_vtu',
          expect.objectContaining({
            category: 'AIRTIME',
            provider: 'MTN',
            providerSource: 'monnify',
          })
        );
      });

      it('uses the discovered Monnify airtime biller code for product lookup', async () => {
        mockGetMonnifyBillers.mockResolvedValueOnce([
          {
            billerCategoryCode: 'AIRTIME',
            billerCode: 'MTN_AIRTIME',
            categoryCodes: ['AIRTIME'],
            description: 'MTN Nigeria Airtime',
            name: 'MTN Nigeria',
          },
        ]);
        mockGetMonnifyBillerProducts.mockResolvedValueOnce([
          {
            amount: null,
            billerCode: 'MTN_AIRTIME',
            categoryCode: 'AIRTIME',
            fee: null,
            isAmountFixed: false,
            maxAmount: null,
            minAmount: 100,
            name: 'MTN Mobile Top up',
            productCode: '13',
          },
        ]);
        const { insert, supabase } = createMockSupabase();

        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'airtime',
            amount: 1000,
            phoneNumber: '08012345678',
            networkProvider: 'mtn',
            provider: 'monnify',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(mockGetMonnifyBillerProducts).toHaveBeenCalledWith(
          'MTN_AIRTIME'
        );
        expect(mockVerifyMonnifyBillCustomer).toHaveBeenCalledWith(
          'MTN_AIRTIME',
          '13',
          '08012345678'
        );
        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              billerCode: 'MTN_AIRTIME',
              productCode: '13',
              provider: 'monnify',
            }),
          })
        );
      });

      it('falls back to Kuda for auto-routed airtime when Monnify resolution fails', async () => {
        mockGetMonnifyBillerProducts.mockRejectedValueOnce(
          new Error('Monnify unavailable')
        );
        const { insert, supabase } = createMockSupabase();
        await preparePendingVtuTransaction({
          supabase,
          user: {
            id: 'user-1',
            email: 'customer@example.com',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['user'],
          input: {
            merchantSlug: 'ogabassey',
            type: 'airtime',
            amount: 1000,
            phoneNumber: '08012345678',
            networkProvider: 'mtn',
            billerCode: 'MONNIFY-BCODE',
            source: 'checkout',
          } as unknown as Parameters<
            typeof preparePendingVtuTransaction
          >[0]['input'],
          source: 'checkout',
        });

        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.not.objectContaining({
              billerCode: 'MONNIFY-BCODE',
            }),
          })
        );
        const insertCall = insert.mock.calls[0]?.[0] as
          | { metadata?: Record<string, unknown> }
          | undefined;
        expect(insertCall?.metadata?.provider).toBe('kuda');
        expect(mockLoggerWarn).toHaveBeenCalledWith({
          message: 'Monnify airtime resolution failed; falling back Kuda',
          error: 'Monnify unavailable',
          networkProvider: 'MTN',
        });
      });

      it('throws for explicit Monnify airtime when Monnify validation fails', async () => {
        mockVerifyMonnifyBillCustomer.mockResolvedValueOnce({
          verified: false,
          message: 'Invalid phone number',
        });
        const { supabase } = createMockSupabase();

        await expect(
          preparePendingVtuTransaction({
            supabase,
            user: {
              id: 'user-1',
              email: 'customer@example.com',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['user'],
            input: {
              merchantSlug: 'ogabassey',
              type: 'airtime',
              amount: 1000,
              phoneNumber: '08012345678',
              networkProvider: 'mtn',
              provider: 'monnify',
              source: 'checkout',
            } as unknown as Parameters<
              typeof preparePendingVtuTransaction
            >[0]['input'],
            source: 'checkout',
          })
        ).rejects.toThrow(
          'Monnify validation failed. Please verify the details and try again.'
        );
      });
    });
  });
});

describe('preparePendingVtuTransaction strictLookups', () => {
  function supabaseWithLookupErrors({
    customerError = null,
    merchantError = null,
    merchantMiss = false,
    settingsError = null,
  }: {
    customerError?: { message: string } | null;
    merchantError?: { message: string } | null;
    merchantMiss?: boolean;
    settingsError?: { message: string } | null;
  }) {
    const merchantRow =
      merchantError || merchantMiss ? null : { id: 'merchant-1' };
    return {
      from: vi.fn((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: merchantRow,
                  error: merchantError,
                }),
                single: vi.fn().mockResolvedValue({
                  data: merchantRow,
                  error: merchantError,
                }),
              }),
            }),
          };
        }
        if (table === 'merchant_feature_settings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: settingsError
                    ? null
                    : { vtu_enabled: true, vtu_airtime_enabled: true },
                  error: settingsError,
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: customerError,
                }),
              }),
            }),
          }),
        };
      }),
    } as unknown as PrepareSupabase;
  }

  function prepareStrictAirtime(supabase: PrepareSupabase) {
    return preparePendingVtuTransaction({
      supabase,
      user: {
        id: 'user-1',
        email: 'customer@example.com',
      } as unknown as Parameters<
        typeof preparePendingVtuTransaction
      >[0]['user'],
      input: {
        merchantSlug: 'ogabassey',
        type: 'airtime',
        amount: 1000,
        phoneNumber: '08012345678',
        networkProvider: 'mtn',
        source: 'checkout',
      },
      source: 'checkout',
      requireCustomer: true,
      strictLookups: true,
    });
  }

  it('throws on transient merchant error instead of Merchant-not-found 400', async () => {
    const supabase = supabaseWithLookupErrors({
      merchantError: { message: 'connection reset' },
    });

    await expect(prepareStrictAirtime(supabase)).rejects.toThrow(
      /Failed to resolve VTU merchant/
    );
  });

  it('throws on transient settings error instead of VTU-disabled 400', async () => {
    const supabase = supabaseWithLookupErrors({
      settingsError: { message: 'timeout' },
    });

    await expect(prepareStrictAirtime(supabase)).rejects.toThrow(
      /Failed to load VTU merchant settings/
    );
  });

  it('throws on transient customer error instead of Customer-404', async () => {
    const supabase = supabaseWithLookupErrors({
      customerError: { message: 'connection reset' },
    });

    await expect(prepareStrictAirtime(supabase)).rejects.toThrow(
      /Failed to look up VTU customer/
    );
  });

  it('throws (never Merchant-not-found) when strict alias resolution fails', async () => {
    // An alias-DB failure must not masquerade as "Merchant not found":
    // the merchant exists; the lookup is indeterminate and the caller
    // must 500 (key kept) instead of terminally rejecting.
    mockGetCurrentSlugForAliasStrict.mockRejectedValueOnce(
      new Error('[Slug Alias Cache] alias lookup failed for slug: ogabassey')
    );
    const supabase = supabaseWithLookupErrors({ merchantMiss: true });

    await expect(prepareStrictAirtime(supabase)).rejects.toThrow(
      /alias lookup failed/
    );
  });

  it('keeps legacy 400s on lookup errors when not strict', async () => {
    const supabase = supabaseWithLookupErrors({
      merchantError: { message: 'connection reset' },
    });

    await expect(
      preparePendingVtuTransaction({
        supabase,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as unknown as Parameters<
          typeof preparePendingVtuTransaction
        >[0]['user'],
        input: {
          merchantSlug: 'ogabassey',
          type: 'airtime',
          amount: 1000,
          phoneNumber: '08012345678',
          networkProvider: 'mtn',
          source: 'checkout',
        },
        source: 'checkout',
        requireCustomer: true,
      })
    ).rejects.toThrow('Merchant not found');
  });
});
