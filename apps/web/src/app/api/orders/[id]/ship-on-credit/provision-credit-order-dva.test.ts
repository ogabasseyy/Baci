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

import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import { generatePaymentAccount } from '@/lib/paystack';
import { provisionCreditOrderDva } from './provision-credit-order-dva';

describe('provisionCreditOrderDva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists and returns a newly generated DVA through the due date', async () => {
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

    const result = await provisionCreditOrderDva({
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      orderId: 'order-1',
      paymentDueDate: '2026-08-28',
      supabase: {} as SupabaseClient,
      now: new Date('2026-08-27T12:00:00.000Z'),
    });

    expect(result).toEqual({
      account_name: 'Baci / Ada',
      account_number: '1234567890',
      bank_name: 'Paystack-Titan',
    });
    expect(generatePaymentAccount).toHaveBeenCalledWith({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '',
      orderId: 'order-1',
    });
    expect(persistPaystackDvaAssignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expiresAt: '2026-08-29T00:00:00.000Z',
      })
    );
  });

  it('returns null without calling Paystack when customer email is missing', async () => {
    const result = await provisionCreditOrderDva({
      customerEmail: '   ',
      customerName: 'Ada Lovelace',
      orderId: 'order-1',
      supabase: {} as SupabaseClient,
    });

    expect(result).toBeNull();
    expect(generatePaymentAccount).not.toHaveBeenCalled();
    expect(persistPaystackDvaAssignment).not.toHaveBeenCalled();
  });
});
