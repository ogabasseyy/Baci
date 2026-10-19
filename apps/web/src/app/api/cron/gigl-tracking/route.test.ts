import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => ({ rpc: vi.fn() }));
const mockCreateWorkerClient = vi.hoisted(() => vi.fn(() => mockSupabase));
vi.mock('@/lib/gigl-tracking-worker-client', () => ({
  createGiglTrackingWorkerClient: mockCreateWorkerClient,
}));

const mockIsGiglRuntimeConfigured = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/lib/shipping/providers/gigl.constants', () => ({
  isGiglRuntimeConfigured: mockIsGiglRuntimeConfigured,
}));

const mockProcess = vi.hoisted(() => vi.fn());
vi.mock('./gigl-tracking-monitor-worker', () => ({
  claimedGiglTrackingMonitorsSchema: {
    safeParse: (value: unknown) => ({ data: value, success: true }),
  },
  processClaimedGiglTrackingMonitors: mockProcess,
}));

import { GET, maxDuration } from './route';

function request(path = '/api/cron/gigl-tracking') {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { Authorization: 'Bearer secret' },
  });
}

describe('GET /api/cron/gigl-tracking', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.clearAllMocks();
    mockIsGiglRuntimeConfigured.mockReturnValue(true);
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    mockProcess.mockResolvedValue({
      applied: 0,
      claimed: 0,
      failed: 0,
      paused: 0,
      success: true,
    });
  });

  it('rejects an invalid cron secret before creating a worker client', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/gigl-tracking')
    );
    expect(response.status).toBe(401);
    expect(mockCreateWorkerClient).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('claims bounded monitors and returns the worker summary', async () => {
    const response = await GET(request('?batchSize=9'));
    expect(response.status).toBe(200);
    expect(mockCreateWorkerClient).toHaveBeenCalledWith(process.env);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      expect.objectContaining({ p_limit: 9 })
    );
    await expect(response.json()).resolves.toEqual({
      applied: 0,
      claimed: 0,
      failed: 0,
      paused: 0,
      success: true,
    });
  });

  it('rejects a non-numeric batch size', async () => {
    const response = await GET(request('?batchSize=abc'));

    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('does not claim monitors when GIGL is disabled', async () => {
    mockIsGiglRuntimeConfigured.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applied: 0,
      claimed: 0,
      failed: 0,
      paused: 0,
      success: true,
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('clamps an oversized batch size to the provider-safe maximum', async () => {
    const response = await GET(request('?batchSize=999'));

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      expect.objectContaining({ p_limit: 50 })
    );
  });

  it('returns 500 when its monitor claim fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'down' },
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to claim GIGL tracking monitors',
    });
  });

  it('returns a bounded 500 when the worker token is invalid', async () => {
    mockCreateWorkerClient.mockImplementationOnce(() => {
      throw new Error('expired worker token');
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'GIGL tracking worker unavailable',
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('uses a bounded function duration', () => {
    expect(maxDuration).toBe(60);
  });
});
