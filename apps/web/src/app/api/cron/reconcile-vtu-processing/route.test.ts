import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getCronSecret: vi.fn(() => 'cron-secret'),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ admin: true })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/vtu-processing-reconciliation', () => ({
  reconcileProcessingVtuTransactions: vi.fn(),
}));

import { getCronSecret } from '@/env';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';
import { GET, maxDuration } from './route';

function createCronRequest(auth = 'Bearer cron-secret') {
  return new NextRequest(
    'http://localhost:3000/api/cron/reconcile-vtu-processing',
    {
      headers: auth ? { authorization: auth } : {},
      method: 'GET',
    }
  );
}

describe('GET /api/cron/reconcile-vtu-processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCronSecret).mockReturnValue('cron-secret');
  });

  it('returns 401 when the cron secret is invalid', async () => {
    const response = await GET(createCronRequest('Bearer wrong-secret'));

    expect(response.status).toBe(401);
  });

  it('returns 500 when the cron secret is missing', async () => {
    vi.mocked(getCronSecret).mockReturnValue(undefined);

    const response = await GET(createCronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'server_misconfigured',
      error: 'Server misconfigured',
    });
  });

  it('reconciles processing VTU transactions with an admin client', async () => {
    vi.mocked(reconcileProcessingVtuTransactions).mockResolvedValue({
      checked: 2,
      errored: 0,
      errors: [],
      failed: 0,
      processing: 1,
      successful: 1,
    });

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checked: 2,
      errored: 0,
      errors: [],
      failed: 0,
      processing: 1,
      successful: 1,
    });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(reconcileProcessingVtuTransactions).toHaveBeenCalledWith({
      deadlineMs: expect.any(Number),
      supabase: { admin: true },
    });
  });

  it('logs a warning when reconciliation returns row-level errors', async () => {
    const summary = {
      checked: 2,
      errored: 1,
      errors: [{ message: 'Kuda TSQ unavailable', transactionId: 'tx-1' }],
      failed: 0,
      processing: 1,
      successful: 0,
    };
    vi.mocked(reconcileProcessingVtuTransactions).mockResolvedValue(summary);

    const response = await GET(createCronRequest());

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith({
      message: 'Processing VTU reconciliation cron completed with errors',
      summary,
    });
  });

  it('returns 500 when reconciliation fails before a summary is available', async () => {
    vi.mocked(reconcileProcessingVtuTransactions).mockRejectedValueOnce(
      new Error('database timeout')
    );

    const response = await GET(createCronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'internal_error',
      error: 'Internal server error',
    });
  });

  it('allows enough time for provider status checks', () => {
    expect(maxDuration).toBe(300);
  });
});
