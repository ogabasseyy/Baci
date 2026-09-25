import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from '@/lib/logger';
import { generatePaymentAccount } from '@/lib/paystack';
import { provisionInvoiceMethodDva } from './provision-invoice-method-dva';

const persistAssignment = vi.fn();

function baseInput() {
  return {
    persistAssignment,
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    customerPhone: '08010000000',
    merchantPhone: null,
    orderId: 'order-1',
    expiresAt: '2026-10-05T00:00:00.000Z',
    orderCurrency: 'NGN',
    orderLabel: 'invoice' as const,
  };
}

describe('provisionInvoiceMethodDva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provisions, persists, and returns the generated account', async () => {
    vi.mocked(generatePaymentAccount).mockResolvedValue({
      success: true,
      data: {
        account_name: 'Baci / Ada',
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
        customer_code: 'CUS_ada',
      },
    });
    persistAssignment.mockResolvedValue(null);

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(generatePaymentAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        firstName: 'Ada',
        lastName: 'Buyer',
        phone: '08010000000',
        orderId: 'order-1',
        signal: expect.any(AbortSignal),
      })
    );
    expect(persistAssignment).toHaveBeenCalledWith({
      accountName: 'Baci / Ada',
      accountNumber: '1234567890',
      bankName: 'Paystack-Titan',
      customerEmail: 'buyer@example.com',
      expiresAt: '2026-10-05T00:00:00.000Z',
      orderId: 'order-1',
    });
    expect(result).toEqual({
      outcome: 'provisioned',
      virtualAccount: {
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
        account_name: 'Baci / Ada',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Stored auto-generated invoice DVA successfully',
      })
    );
  });

  it('reports a definitive skip for foreign-currency quotes', async () => {
    const result = await provisionInvoiceMethodDva({
      ...baseInput(),
      orderCurrency: 'USD',
    });

    expect(result).toEqual({ outcome: 'skipped' });
    expect(generatePaymentAccount).not.toHaveBeenCalled();
    expect(persistAssignment).not.toHaveBeenCalled();
  });

  it('reports handled provider failures as retryable', async () => {
    // paystackRequest converts HTTP errors and fetch rejections into
    // { success: false }: the caller may provision again post-response.
    vi.mocked(generatePaymentAccount).mockResolvedValue({
      success: false,
      error: 'provider down',
    });

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(result).toEqual({ outcome: 'failed' });
    expect(persistAssignment).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Auto-generation of invoice DVA failed',
      })
    );
  });

  it('reports uncertain persistence instead of retryable', async () => {
    vi.mocked(generatePaymentAccount).mockResolvedValue({
      success: true,
      data: {
        account_name: 'Baci / Ada',
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
        customer_code: 'CUS_ada',
      },
    });
    // Any truthy value signals a persistence failure (the helper
    // returns a NextResponse failure payload on error paths).
    persistAssignment.mockResolvedValue({});

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(result).toEqual({ outcome: 'uncertain' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to store auto-generated invoice DVA',
      })
    );
  });

  it('aborts a stalled provider and reports retryable without persisting', async () => {
    vi.useFakeTimers();
    try {
      // Never-settling provider request, aborted like a real fetch:
      // the deadline must cancel the request (so it cannot race the
      // post-response retry into a duplicate account) and release the
      // pre-response order-creation POST instead of hanging it.
      let observedSignal: AbortSignal | undefined;
      vi.mocked(generatePaymentAccount).mockImplementation(
        (input) =>
          new Promise<never>((_resolve, reject) => {
            observedSignal = input.signal;
            input.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          })
      );

      const pending = provisionInvoiceMethodDva(baseInput());
      const assertion = expect(pending).resolves.toEqual({
        outcome: 'failed',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(observedSignal?.aborted).toBe(true);
      expect(persistAssignment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
