import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  hasValidCronSecret: vi.fn(),
  loggerError: vi.fn(),
  runBatch: vi.fn(),
  safeParseBatchSize: vi.fn(),
}));

vi.mock('@/lib/cron-secret-auth', () => ({
  hasValidCronSecret: mocks.hasValidCronSecret,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/schemas/cron-batch-size', () => ({
  createCronBatchSizeSchema: () => ({
    safeParse: mocks.safeParseBatchSize,
  }),
}));
vi.mock('./run-gigl-tracking-notification-batch', () => ({
  runGiglTrackingNotificationBatch: mocks.runBatch,
}));

import { GET } from './route';

const endpoint = 'http://localhost:3000/api/cron/gigl-tracking-notifications';
const serviceClient = { rpc: vi.fn() };
const summary = {
  claimed: 2,
  failed: 0,
  sent: 1,
  skipped: 1,
  success: true,
};

describe('GET /api/cron/gigl-tracking-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCronSecret.mockReturnValue(true);
    mocks.safeParseBatchSize.mockReturnValue({ data: 10, success: true });
    mocks.createServiceClient.mockReturnValue(serviceClient);
    mocks.runBatch.mockResolvedValue({ ok: true, summary });
  });

  it('returns 401 without constructing a service client when authentication fails', async () => {
    // Arrange
    mocks.hasValidCronSecret.mockReturnValue(false);

    // Act
    const response = await GET(new Request(endpoint));

    // Assert
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('returns 400 without constructing a service client when batchSize is invalid', async () => {
    // Arrange
    mocks.safeParseBatchSize.mockReturnValue({
      error: new Error('invalid'),
      success: false,
    });

    // Act
    const response = await GET(new Request(`${endpoint}?batchSize=invalid`));

    // Assert
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid batch size',
    });
    expect(mocks.safeParseBatchSize).toHaveBeenCalledWith('invalid');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it('returns the notification worker summary after a successful batch', async () => {
    // Arrange
    mocks.safeParseBatchSize.mockReturnValue({ data: 7, success: true });

    // Act
    const response = await GET(new Request(`${endpoint}?batchSize=7`));

    // Assert
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summary);
    expect(mocks.createServiceClient).toHaveBeenCalledWith('event-pipeline');
    expect(mocks.runBatch).toHaveBeenCalledWith({
      batchSize: 7,
      client: serviceClient,
      workerId: expect.stringMatching(/^gigl-notifications-/),
    });
  });

  it.each([
    {
      error: 'Failed to claim GIGL tracking notifications',
      reason: 'claim_failed',
    },
    {
      error: 'Invalid GIGL tracking notification payload',
      reason: 'invalid_claim_payload',
    },
    {
      error: 'Failed to process GIGL tracking notifications',
      reason: 'worker_failed',
    },
  ])('returns 500 when the worker reports $reason', async ({
    error,
    reason,
  }) => {
    // Arrange
    mocks.runBatch.mockResolvedValue({ ok: false, reason });

    // Act
    const response = await GET(new Request(endpoint));

    // Assert
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.loggerError).toHaveBeenCalledOnce();
  });
});
