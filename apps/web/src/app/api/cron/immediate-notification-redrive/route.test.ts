import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createClient: vi.fn(),
  recover: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/cron-secret-auth', () => ({
  hasValidCronSecret: mocks.authenticate,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.error, warn: mocks.warn },
}));
vi.mock('@/lib/immediate-order/notification-redrive-client', () => ({
  createImmediateNotificationRedriveClient: mocks.createClient,
}));
vi.mock('@/lib/immediate-order/notification-redrive-worker', () => ({
  recoverImmediateNotifications: mocks.recover,
}));

import { GET } from './route';

const endpoint = 'https://example.test/api/cron/immediate-notification-redrive';
describe('immediate notification redrive cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED', 'true');
    mocks.authenticate.mockReturnValue(true);
    mocks.createClient.mockReturnValue({ rpc: vi.fn() });
    mocks.recover.mockResolvedValue({
      recovered: 1,
      unresolved: 0,
      hasReconciliationBacklog: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects unauthorized calls before constructing the worker client', async () => {
    mocks.authenticate.mockReturnValue(false);
    expect((await GET(new Request(endpoint))).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('does not use the worker before cutover', async () => {
    vi.stubEnv('IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED', 'false');
    expect((await GET(new Request(endpoint))).status).toBe(204);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects invalid batch sizes before constructing the worker client', async () => {
    expect((await GET(new Request(`${endpoint}?batchSize=101`))).status).toBe(
      400
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('processes a bounded batch and logs unresolved delivery without details', async () => {
    mocks.recover.mockResolvedValue({
      recovered: 1,
      unresolved: 2,
      hasReconciliationBacklog: true,
    });
    const response = await GET(new Request(`${endpoint}?batchSize=7`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      recovered: 1,
      unresolved: 2,
      hasReconciliationBacklog: true,
    });
    expect(mocks.recover).toHaveBeenCalledWith(expect.anything(), 7);
    expect(mocks.warn).toHaveBeenCalledWith({
      message: 'Immediate notification deliveries require reconciliation',
      unresolved: 2,
      hasReconciliationBacklog: true,
    });
  });

  it('returns a generic error without exposing worker credentials or details', async () => {
    mocks.recover.mockRejectedValue(new Error('sensitive fixture'));
    const response = await GET(new Request(endpoint));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive fixture');
    expect(mocks.error).toHaveBeenCalledWith({
      message: 'Immediate notification recovery failed',
    });
  });
});
