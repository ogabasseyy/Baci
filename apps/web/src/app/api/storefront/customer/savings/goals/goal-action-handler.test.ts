import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveCustomerSavingsContext = vi.fn();
const mockGetCustomerSavingsFeatureSettings = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/app/api/storefront/customer/savings/shared', () => ({
  getCustomerSavingsFeatureSettings: (...args: unknown[]) =>
    mockGetCustomerSavingsFeatureSettings(...args),
  resolveCustomerSavingsContext: (...args: unknown[]) =>
    mockResolveCustomerSavingsContext(...args),
}));

import { executeSavingsGoalAction } from './goal-action-handler';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/savings/goals/pause',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('executeSavingsGoalAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { authScope: 'customer' },
      user: { id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
    mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
      autoDebitEnabled: true,
      paystackEnabled: true,
      savingsEnabled: true,
    });
  });

  it('returns action success when RPC succeeds', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ goal_status: 'paused', success: true }],
        error: null,
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'pause_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'pause_customer_savings_goal',
      expect.objectContaining({
        p_customer_id: 'customer-1',
        p_goal_id: '00000000-0000-4000-8000-000000000101',
        p_merchant_id: 'merchant-1',
      })
    );
    expect(body).toEqual({ goalStatus: 'paused', success: true });
  });

  it('returns 401 before CSRF or parsing when authentication fails', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Unauthorized',
      user: null,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'pause_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('returns 400 when the goal action body is invalid', async () => {
    const response = await executeSavingsGoalAction({
      request: postRequest({ merchantSlug: 'ogabassey' }),
      rpcName: 'pause_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('returns 400 when the goal action body contains malformed JSON', async () => {
    const response = await executeSavingsGoalAction({
      request: new NextRequest(
        'http://localhost:3000/api/storefront/customer/savings/goals/pause',
        {
          body: '{',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }
      ),
      rpcName: 'pause_customer_savings_goal',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'MALFORMED_JSON',
      error: 'Malformed JSON',
    });
    expect(mockResolveCustomerSavingsContext).not.toHaveBeenCalled();
  });

  it('returns 403 when the savings feature is disabled', async () => {
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: { rpc: vi.fn() },
    });
    mockGetCustomerSavingsFeatureSettings.mockResolvedValue({
      autoDebitEnabled: true,
      paystackEnabled: true,
      savingsEnabled: false,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'resume_customer_savings_goal',
    });

    expect(response.status).toBe(403);
  });

  it('maps action rpc conflicts to 409', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0001',
          message: 'savings_goal_not_paused',
        },
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'resume_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('savings_goal_not_paused');
  });

  it('maps pending-transfer cancellation blocks to 409 for retry', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0001',
          message: 'savings_goal_not_cancellable_pending_transfer',
        },
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'cancel_customer_savings_goal_future_debits',
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('savings_goal_not_cancellable_pending_transfer');
  });

  it('returns 500 for unexpected action RPC errors', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0000',
          message: 'unexpected savings action failure',
        },
      }),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'pause_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      code: 'P0000',
      error: 'Failed to update savings goal',
    });
  });

  it('returns 500 when the action RPC throws', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };
    mockResolveCustomerSavingsContext.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1' },
      supabase: mockSupabase,
    });

    const response = await executeSavingsGoalAction({
      request: postRequest({
        goalId: '00000000-0000-4000-8000-000000000101',
        merchantSlug: 'ogabassey',
      }),
      rpcName: 'pause_customer_savings_goal',
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to update savings goal' });
  });
});
