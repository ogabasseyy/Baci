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

describe('runPaidOrderSideEffects failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ messageId: 'msg-1', success: true });
  });

  it('skips paid email when merchant details or customer email are unavailable', async () => {
    for (const [supabase, order] of [
      [createSupabase({ merchantData: null }), richOrder],
      [createSupabase({ merchantData: { business_name: 123 } }), richOrder],
      [createSupabase(), { ...richOrder, customer_email: null }],
    ] as const) {
      mockApplyPaidOrderSideEffects.mockImplementationOnce(async (input) => {
        const { executors } = input as {
          executors: { paid_email: () => Promise<{ skipped?: string }> };
        };
        const emailResult = await executors.paid_email();
        return {
          failedSteps: [],
          ranSteps: emailResult.skipped ? [] : ['paid_email'],
        };
      });

      await expect(
        runPaidOrderSideEffects({
          actor: 'webhook:PSK_REF_1',
          externalGatewayReference: 'PSK_REF_1',
          gatewayResponse: {},
          order,
          scheduleAfter: vi.fn(),
          settlementGateway: 'paystack',
          supabase: supabase as never,
          transaction,
        })
      ).resolves.toMatchObject({
        failedSteps: [],
        ranSteps: [],
      });
    }
  });

  it('returns failed side-effect steps from the shared outbox helper', async () => {
    mockApplyPaidOrderSideEffects.mockResolvedValueOnce({
      failedSteps: [{ error: 'email_failed', step: 'paid_email' }],
      ranSteps: ['paid_email'],
    });

    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction,
      })
    ).resolves.toMatchObject({
      failedSteps: [{ error: 'email_failed', step: 'paid_email' }],
    });
  });

  it.each([
    'failed',
    'cancelled',
  ] as const)('rejects %s orders before scheduling paid side effects', async (paymentStatus) => {
    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: { ...richOrder, payment_status: paymentStatus },
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction,
      })
    ).rejects.toThrow(
      `Paid order side effects cannot run for ${paymentStatus} orders`
    );
    expect(mockApplyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('rejects mixed merchant context before building side effects', async () => {
    const supabase = createSupabase();

    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: { ...richOrder, merchant_id: 'merchant-2' },
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: supabase as never,
        transaction,
      })
    ).rejects.toThrow('paid_order_merchant_mismatch');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockApplyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('returns a paid-email failure when the email executor fails', async () => {
    mockSendEmail.mockResolvedValueOnce({
      error: 'smtp_failed',
      success: false,
    });
    mockApplyPaidOrderSideEffects.mockImplementationOnce(async (input) => {
      const { executors } = input as {
        executors: {
          paid_email: () => Promise<unknown>;
        };
      };
      try {
        await executors.paid_email();
        return { failedSteps: [], ranSteps: ['paid_email'] };
      } catch (error) {
        return {
          failedSteps: [
            {
              error: error instanceof Error ? error.message : String(error),
              step: 'paid_email',
            },
          ],
          ranSteps: [],
        };
      }
    });

    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: {},
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: createSupabase() as never,
        transaction,
      })
    ).resolves.toMatchObject({
      failedSteps: [{ error: 'smtp_failed', step: 'paid_email' }],
      ranSteps: [],
    });
  });

  it('returns a merchant settlement failure while preserving gateway metadata', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'settlement failed' },
    } as never);
    mockApplyPaidOrderSideEffects.mockImplementationOnce(async (input) => {
      const { executors } = input as {
        executors: {
          merchant_settlement: (ctx: {
            gatewayResponse: Record<string, unknown>;
          }) => Promise<unknown>;
        };
      };
      try {
        await executors.merchant_settlement({
          gatewayResponse: { fees: 19_600, fees_split: null, subaccount: {} },
        });
        return { failedSteps: [], ranSteps: ['merchant_settlement'] };
      } catch (error) {
        return {
          failedSteps: [
            {
              error: error instanceof Error ? error.message : String(error),
              step: 'merchant_settlement',
            },
          ],
          ranSteps: [],
        };
      }
    });

    await expect(
      runPaidOrderSideEffects({
        actor: 'webhook:PSK_REF_1',
        allocatedGatewayFeeNgn: 300,
        externalGatewayReference: 'PSK_REF_1',
        gatewayResponse: { fees: 19_600 },
        order: richOrder,
        scheduleAfter: vi.fn(),
        settlementGateway: 'paystack',
        supabase: supabase as never,
        transaction,
      })
    ).resolves.toMatchObject({
      failedSteps: [
        { error: 'settlement failed', step: 'merchant_settlement' },
      ],
      ranSteps: [],
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_gateway_fee: 300,
        p_gateway_reference: 'PSK_REF_1',
      })
    );
  });
});
