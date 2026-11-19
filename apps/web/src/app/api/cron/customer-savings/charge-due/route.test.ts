import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockChargeDueCustomerSavingsGoals = vi.fn();
const mockCreateServiceClient = vi.fn();
const mockGetCronSecret = vi.fn();
const mockHasValidCronSecret = vi.fn();

vi.mock('@/env', () => ({
  getCronSecret: () => mockGetCronSecret(),
}));

vi.mock('@/lib/cron-secret-auth', () => ({
  hasValidCronSecret: (...args: unknown[]) => mockHasValidCronSecret(...args),
}));

vi.mock('@/lib/customer-savings-auto-debit', () => ({
  chargeDueCustomerSavingsGoals: (...args: unknown[]) =>
    mockChargeDueCustomerSavingsGoals(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

import { POST } from './route';

function request(headers: Record<string, string> = {}) {
  return new NextRequest(
    'http://localhost:3000/api/cron/customer-savings/charge-due',
    { method: 'POST', headers }
  );
}

describe('/api/cron/customer-savings/charge-due', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServiceClient.mockReturnValue({ from: vi.fn(), rpc: vi.fn() });
    mockGetCronSecret.mockReturnValue('cron-secret');
    mockHasValidCronSecret.mockReturnValue(true);
    mockChargeDueCustomerSavingsGoals.mockResolvedValue({
      errored: 0,
      failed: 0,
      processed: 1,
      results: [{ goalId: 'goal-1', status: 'charged' }],
      skipped: 0,
    });
  });

  it('fails closed when the cron secret is invalid', async () => {
    mockHasValidCronSecret.mockReturnValue(false);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockChargeDueCustomerSavingsGoals).not.toHaveBeenCalled();
  });

  it('charges due customer savings goals with the service client', async () => {
    const supabase = { from: vi.fn(), rpc: vi.fn() };
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(
      request({ authorization: 'Bearer cron-secret' })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockHasValidCronSecret).toHaveBeenCalledWith(
      expect.any(Headers),
      'cron-secret'
    );
    expect(mockChargeDueCustomerSavingsGoals).toHaveBeenCalledWith({
      supabase,
    });
    expect(body).toEqual({
      errored: 0,
      failed: 0,
      processed: 1,
      skipped: 0,
      success: true,
    });
  });

  it('returns success counts when some due savings charges fail', async () => {
    const supabase = { from: vi.fn(), rpc: vi.fn() };
    mockCreateServiceClient.mockReturnValue(supabase);
    mockChargeDueCustomerSavingsGoals.mockResolvedValue({
      errored: 0,
      failed: 2,
      processed: 5,
      results: [
        { goalId: 'goal-1', status: 'charged' },
        { goalId: 'goal-2', status: 'failed' },
      ],
      skipped: 1,
    });

    const response = await POST(
      request({ authorization: 'Bearer cron-secret' })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockChargeDueCustomerSavingsGoals).toHaveBeenCalledWith({
      supabase,
    });
    expect(body).toEqual({
      errored: 0,
      failed: 2,
      processed: 5,
      skipped: 1,
      success: true,
    });
  });

  it('returns success counts when there are no due savings goals', async () => {
    mockChargeDueCustomerSavingsGoals.mockResolvedValue({
      errored: 0,
      failed: 0,
      processed: 0,
      results: [],
      skipped: 0,
    });

    const response = await POST(
      request({ authorization: 'Bearer cron-secret' })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      errored: 0,
      failed: 0,
      processed: 0,
      skipped: 0,
      success: true,
    });
  });

  it('returns 500 when due savings charging throws', async () => {
    mockChargeDueCustomerSavingsGoals.mockRejectedValue(
      new Error('charge job failed')
    );

    const response = await POST(
      request({ authorization: 'Bearer cron-secret' })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'charge job failed' });
  });

  it('answers 500 when any goal hit an unexpected error, keeping the counts', async () => {
    mockChargeDueCustomerSavingsGoals.mockResolvedValue({
      errored: 2,
      failed: 2,
      processed: 1,
      results: [],
      skipped: 0,
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      errored: 2,
      failed: 2,
      processed: 1,
    });
  });

  it('stays 200 when goals only failed for ordinary reasons (declines)', async () => {
    mockChargeDueCustomerSavingsGoals.mockResolvedValue({
      errored: 0,
      failed: 3,
      processed: 0,
      results: [],
      skipped: 0,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
  });
});
