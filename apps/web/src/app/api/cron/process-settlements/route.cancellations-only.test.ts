import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  processCancellationDrain: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

vi.mock('./process-cancellation-drain', () => ({
  processCancellationDrain: mocks.processCancellationDrain,
}));

import { POST } from './route';

function makeCancellationDrainRequest() {
  return new Request(
    'https://usebaci.com/api/cron/process-settlements?cancellationsOnly=true',
    {
      headers: { Authorization: 'Bearer test-secret' },
      method: 'POST',
    }
  );
}

describe('POST /api/cron/process-settlements?cancellationsOnly=true', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mocks.processCancellationDrain.mockResolvedValue(
      NextResponse.json({ success: true })
    );
  });

  it('delegates to the cancellation drain and returns its response', async () => {
    const response = await POST(makeCancellationDrainRequest());

    expect(mocks.processCancellationDrain).toHaveBeenCalledWith(
      expect.objectContaining({ from: mocks.from, rpc: mocks.rpc })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('rejects unauthenticated cancellation drains before delegating', async () => {
    const response = await POST(
      new Request(
        'https://usebaci.com/api/cron/process-settlements?cancellationsOnly=true',
        { headers: { Authorization: 'Bearer wrong' }, method: 'POST' }
      )
    );

    expect(response.status).toBe(401);
    expect(mocks.processCancellationDrain).not.toHaveBeenCalled();
  });
});
