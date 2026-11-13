import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  secret: vi.fn(),
  runtime: vi.fn(),
  drain: vi.fn(),
  pending: vi.fn(),
}));
vi.mock('@/lib/piggyvest/wallet-pay-work-pending', () => ({
  isWalletPayWorkPending: mocks.pending,
}));
vi.mock('@/lib/cron-secret-auth', () => ({ hasValidCronSecret: mocks.secret }));
vi.mock('@/lib/piggyvest/wallet-pay-runtime', () => ({
  readWalletPayRecoveryRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/wallet-pay-drain', () => ({
  runWalletPayDrain: mocks.drain,
}));
vi.mock('@/lib/piggyvest/wallet-pay-deliverers', () => ({
  WALLET_PAY_DELIVERERS: {},
}));

const request = () =>
  new Request('https://example.test/api/cron/piggyvest-wallet-pay-drain');

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PIGGYVEST_COLLECTION_WALLET_ID', 'collection-wallet-1');
  mocks.secret.mockReturnValue(true);
  mocks.runtime.mockReturnValue({ tag: 'runtime' });
  mocks.drain.mockResolvedValue({
    released: 0,
    settled: 1,
    refunds: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
  });
});

describe('GET /api/cron/piggyvest-wallet-pay-drain', () => {
  it('requires the cron secret and does nothing without it', async () => {
    mocks.secret.mockReturnValue(false);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it('runs the drain under the recovery runtime and returns counts only', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      released: 0,
      settled: 1,
      refunds: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mocks.drain).toHaveBeenCalledWith({
      runtime: { tag: 'runtime' },
      deliverers: {},
    });
  });

  it('is a 200 no-op while no collection wallet is configured and nothing waits', async () => {
    vi.stubEnv('PIGGYVEST_COLLECTION_WALLET_ID', '');
    mocks.pending.mockResolvedValue(false);
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'not_configured',
    });
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it('bugfix: pages when wallet pay work waits but the collection wallet is gone (Codex P1)', async () => {
    vi.stubEnv('PIGGYVEST_COLLECTION_WALLET_ID', '');
    mocks.pending.mockResolvedValue(true);
    expect((await GET(request())).status).toBe(503);
    mocks.pending.mockRejectedValue(new Error('db down'));
    expect((await GET(request())).status).toBe(503);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it('still requires the cron secret before the not-configured answer', async () => {
    vi.stubEnv('PIGGYVEST_COLLECTION_WALLET_ID', '');
    mocks.secret.mockReturnValue(false);
    expect((await GET(request())).status).toBe(401);
  });

  it('answers 503 when wallet pay is misconfigured', async () => {
    mocks.runtime.mockImplementation(() => {
      throw new Error('missing');
    });
    expect((await GET(request())).status).toBe(503);
  });

  it('answers 500 when the drain itself fails', async () => {
    mocks.drain.mockRejectedValue(new Error('db'));
    expect((await GET(request())).status).toBe(500);
  });

  it('bugfix: fails the run when any item threw, still with counts only (Codex P2)', async () => {
    mocks.drain.mockResolvedValue({
      released: 0,
      settled: 0,
      refunds: 0,
      delivered: 0,
      skipped: 0,
      failed: 1,
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ failed: 1 });
  });
});
