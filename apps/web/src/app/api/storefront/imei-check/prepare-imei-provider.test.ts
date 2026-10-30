import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { prepareImeiProvider } from './prepare-imei-provider';

const config = vi.hoisted(() => ({ disabled: [] as string[], enabled: true }));
vi.mock('@/env', () => ({
  getImeiDisabledTierKeys: () => config.disabled,
  getImeiIdentifierEncryptionKey: () => 'encryption-key',
  getPetrockConfig: () => ({
    baseUrl: 'https://api.petrock.biz/api/reseller/v1',
    token: 'test-token',
  }),
  getPetrockEnabledTierKeys: () => ['simLock'],
  getSickwApiKey: () => 'sickw-test-key',
  isPetrockEnabled: () => config.enabled,
}));
function input(clientSupportsAsync = true) {
  const readSnapshot = vi.fn().mockResolvedValue({
    data: {
      active: true,
      currency: 'USD',
      order_field_name: 'IMEI',
      price_usd: 0.06,
      product_id: '716',
      synced_at: new Date().toISOString(),
    },
    error: null,
  });
  return {
    access: { readSnapshot } as unknown as ImeiAccessClient,
    clientSupportsAsync,
    deviceCategory: 'smartphone' as const,
    requestedTier: 'simLock' as const,
  };
}

describe('IMEI provider preparation', () => {
  beforeEach(() => {
    config.disabled = [];
    config.enabled = true;
  });
  it('rejects a disabled tier before accessing the provider catalog', async () => {
    config.disabled = ['simLock'];
    const args = input();
    const result = await prepareImeiProvider(args);
    expect(result.response?.status).toBe(503);
    expect(args.access.readSnapshot).not.toHaveBeenCalled();
  });
  it('preserves synchronous Sickw service for clients that cannot poll', async () => {
    const args = input(false);
    const result = await prepareImeiProvider(args);
    expect(result.binding?.provider).toBe('sickw');
    expect(result.serviceTier?.price).toBe(500);
    expect(args.access.readSnapshot).not.toHaveBeenCalled();
  });
  it('refuses stale Petrock evidence without returning an executable provider', async () => {
    const args = input();
    vi.mocked(args.access.readSnapshot).mockResolvedValue({
      data: {
        active: true,
        currency: 'USD',
        order_field_name: 'IMEI',
        price_usd: 0.06,
        product_id: '716',
        synced_at: '2020-01-01T00:00:00Z',
      },
      error: null,
    });
    const result = await prepareImeiProvider(args);
    expect(result.response?.status).toBe(503);
    expect(await result.response?.json()).toMatchObject({
      code: 'PROVIDER_PRICE_STALE',
    });
    expect(result.provider).toBeUndefined();
  });
  it('fails closed when the server-scoped catalog read is denied', async () => {
    const args = input();
    const denied = { message: 'scope denied', code: '42501' };
    vi.mocked(args.access.readSnapshot).mockResolvedValue({
      data: null,
      error: denied,
    });
    await expect(prepareImeiProvider(args)).rejects.toBe(denied);
  });
  it('prepares the reviewed product while retaining its existing retail price', async () => {
    const args = input();
    const result = await prepareImeiProvider(args);
    expect(result.binding).toMatchObject({
      provider: 'petrock',
      productId: '716',
    });
    expect(result.serviceTier?.price).toBe(500);
    expect(args.access.readSnapshot).toHaveBeenCalledWith('716');
  });
});
