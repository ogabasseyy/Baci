import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApplyPaidOrderSideEffects = vi.fn<(...args: unknown[]) => unknown>();
const mockSendEmail = vi.fn<(...args: unknown[]) => unknown>();
const mockTriggerPurchaseConversion = vi.fn<(...args: unknown[]) => unknown>();
const mockGenerateOrderConfirmationEmail = vi.fn<
  (...args: unknown[]) => string
>(() => '<p>ok</p>');
const mockGenerateOrderConfirmationText = vi.fn<(...args: unknown[]) => string>(
  () => 'ok'
);

vi.mock('@/lib/payments/apply-paid-order-side-effects', () => ({
  applyPaidOrderSideEffects: (...args: unknown[]) =>
    mockApplyPaidOrderSideEffects(...args),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock('@/lib/trigger-purchase-conversion', () => ({
  triggerPurchaseConversion: (...args: unknown[]) =>
    mockTriggerPurchaseConversion(...args),
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: (...args: unknown[]) =>
    mockGenerateOrderConfirmationEmail(...args),
  generateOrderConfirmationText: (...args: unknown[]) =>
    mockGenerateOrderConfirmationText(...args),
}));

import { runPaidOrderSideEffects } from '@/lib/payments/run-paid-order-side-effects';
import {
  createPaidOrderSideEffectsSupabase as createSupabase,
  richOrder,
  transaction,
} from '@/lib/payments/run-paid-order-side-effects.test-utils';
import { calculatePlatformFee } from '@/lib/paystack';

describe('runPaidOrderSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
    mockApplyPaidOrderSideEffects.mockImplementation(async (input) => {
      const { executors } = input as {
        executors: {
          ad_tracking_conversion: () => Promise<unknown>;
          merchant_settlement: (ctx: {
            gatewayResponse: Record<string, unknown>;
          }) => Promise<unknown>;
          paid_email: () => Promise<unknown>;
        };
      };
      await executors.paid_email();
      await executors.ad_tracking_conversion();
      await executors.merchant_settlement({
        gatewayResponse: { fees: 19_600 },
      });
      return {
        failedSteps: [],
        ranSteps: ['paid_email', 'merchant_settlement'],
      };
    });
  });

  it('builds paid-email and settlement executors with explicit settlement gateway and allocated fee', async () => {
    const supabase = createSupabase();

    await runPaidOrderSideEffects({
      actor: 'webhook:PSK_REF_1',
      allocatedGatewayFeeNgn: 300,
      externalGatewayReference: 'PSK_REF_1',
      gatewayResponse: { fees: 19_600 },
      order: richOrder,
      scheduleAfter: vi.fn(),
      settlementGateway: 'paystack',
      supabase: supabase as never,
      transaction,
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        clientReference: 'order:order-1:paid_email',
        to: 'jane@example.com',
      })
    );
    expect(supabase.select).toHaveBeenCalledWith(
      expect.stringContaining('business_name')
    );
    expect(supabase.select).toHaveBeenCalledWith(
      expect.not.stringContaining('website_url')
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_gateway_fee: 300,
        p_gateway_reference: 'PSK_REF_1',
        p_metadata: expect.objectContaining({
          paystack_reference: 'PSK_REF_1',
        }),
      })
    );
  });

  it('forwards the abort signal to the paid-email send', async () => {
    const supabase = createSupabase();
    const signal = AbortSignal.timeout(1000);

    await runPaidOrderSideEffects({
      actor: 'cron:reconcile-gateway-paid-orders:drain',
      externalGatewayReference: 'PSK_REF_1',
      gatewayResponse: {},
      order: richOrder,
      scheduleAfter: vi.fn(),
      settlementGateway: 'paystack',
      signal,
      supabase: supabase as never,
      transaction,
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ signal })
    );
  });

  it('schedules ad tracking after the response path instead of inside the outbox', async () => {
    const supabase = createSupabase();
    const scheduleAfter = vi.fn((job: () => Promise<void>) => job());

    await runPaidOrderSideEffects({
      actor: 'webhook:PSK_REF_1',
      externalGatewayReference: 'PSK_REF_1',
      gatewayResponse: {},
      order: richOrder,
      scheduleAfter,
      settlementGateway: 'paystack',
      supabase: supabase as never,
      transaction,
    });

    expect(scheduleAfter).toHaveBeenCalledTimes(1);
    expect(mockTriggerPurchaseConversion).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      expect.objectContaining({
        id: 'order-1',
        order_items: [
          expect.objectContaining({
            id: null,
            name: 'iPhone',
            price: 20_000,
            product_id: null,
            quantity: 1,
          }),
        ],
        shipping_address: { city: 'Lagos', state: 'LA' },
        total: 20_000,
      })
    );
  });

  it('falls back to the calculated platform fee when transaction platform fee is null', async () => {
    const supabase = createSupabase();
    const expectedPlatformFee =
      calculatePlatformFee(transaction.amount * 100).platformFee / 100;

    await runPaidOrderSideEffects({
      actor: 'webhook:PSK_REF_1',
      externalGatewayReference: 'PSK_REF_1',
      gatewayResponse: {},
      order: richOrder,
      scheduleAfter: vi.fn(),
      settlementGateway: 'paystack',
      supabase: supabase as never,
      transaction: { ...transaction, platform_fee: null },
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_platform_fee: expectedPlatformFee,
      })
    );
  });

  it('uses the merchant slug in confirmation email links', async () => {
    const supabase = createSupabase({
      merchantData: {
        business_name: 'Ogabassey',
        cac_rc_number: 'RC123',
        email: 'merchant@example.com',
        email_sender_name: 'Ogabassey',
        slug: 'ogabassey',
        support_email: 'support@example.com',
        tax_identification_number: 'TIN123',
      },
    });

    await runPaidOrderSideEffects({
      actor: 'webhook:PSK_REF_1',
      externalGatewayReference: 'PSK_REF_1',
      gatewayResponse: {},
      order: richOrder,
      scheduleAfter: vi.fn(),
      settlementGateway: 'paystack',
      supabase: supabase as never,
      transaction,
    });

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantUrl: 'https://ogabassey.usebaci.com',
      })
    );
  });

  it('rejects malformed transaction amounts before settlement recording', async () => {
    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction: { ...transaction, amount: '' },
      })
    ).rejects.toThrow('invalid_settlement_executor_args');
  });

  it('rejects non-positive settlement amounts', async () => {
    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction: { ...transaction, amount: 0 },
      })
    ).rejects.toThrow('Settlement amount must be positive');
  });

  it('rejects malformed transaction platform fees before settlement recording', async () => {
    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction: { ...transaction, platform_fee: 'invalid' as never },
      })
    ).rejects.toThrow('invalid_settlement_executor_args');
  });
});
