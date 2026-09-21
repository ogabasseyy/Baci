import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: vi.fn(),
}));
vi.mock('@/lib/payments/persist-paystack-dva-assignment', () => ({
  persistPaystackDvaAssignment: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from '@/lib/logger';
import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import { generatePaymentAccount } from '@/lib/paystack';
import { provisionInvoiceMethodDva } from './provision-invoice-method-dva';

const supabase = {} as SupabaseClient;

function baseInput() {
  return {
    supabase,
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
    vi.mocked(persistPaystackDvaAssignment).mockResolvedValue(null);

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(generatePaymentAccount).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      firstName: 'Ada',
      lastName: 'Buyer',
      phone: '08010000000',
      orderId: 'order-1',
    });
    expect(persistPaystackDvaAssignment).toHaveBeenCalledWith(supabase, {
      accountName: 'Baci / Ada',
      accountNumber: '1234567890',
      bankName: 'Paystack-Titan',
      customerEmail: 'buyer@example.com',
      expiresAt: '2026-10-05T00:00:00.000Z',
      orderId: 'order-1',
    });
    expect(result).toEqual({
      account_number: '1234567890',
      bank_name: 'Paystack-Titan',
      account_name: 'Baci / Ada',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Stored auto-generated invoice DVA successfully',
      })
    );
  });

  it('skips provisioning for foreign-currency quotes', async () => {
    const result = await provisionInvoiceMethodDva({
      ...baseInput(),
      orderCurrency: 'USD',
    });

    expect(result).toBeNull();
    expect(generatePaymentAccount).not.toHaveBeenCalled();
    expect(persistPaystackDvaAssignment).not.toHaveBeenCalled();
  });

  it('returns null when generation fails', async () => {
    vi.mocked(generatePaymentAccount).mockResolvedValue({
      success: false,
      error: 'provider down',
    });

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(result).toBeNull();
    expect(persistPaystackDvaAssignment).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Auto-generation of invoice DVA failed',
      })
    );
  });

  it('returns null when persistence fails', async () => {
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
    vi.mocked(persistPaystackDvaAssignment).mockResolvedValue({} as never);

    const result = await provisionInvoiceMethodDva(baseInput());

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to store auto-generated invoice DVA',
      })
    );
  });
});
