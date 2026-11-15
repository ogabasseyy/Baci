import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAfter = vi.fn((callback: () => unknown) => callback());
const mockPurgeCloudflareHostnamesConfirmed = vi.fn(
  async (_hostnames: string[]) => undefined
);

vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareHostnamesConfirmed: (hostnames: string[]) =>
    mockPurgeCloudflareHostnamesConfirmed(hostnames),
}));

import {
  purgeStorefrontHostnameConfirmed,
  scheduleStorefrontHostnamePurge,
} from './storefront-product-purge-hostnames';

describe('scheduleStorefrontHostnamePurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only schedules the configured public hostnames', () => {
    scheduleStorefrontHostnamePurge('ogabassey');

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockPurgeCloudflareHostnamesConfirmed).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
  });

  it('does not grant a hostname purge to an unknown storefront', () => {
    scheduleStorefrontHostnamePurge('unconfigured-storefront');

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockPurgeCloudflareHostnamesConfirmed).not.toHaveBeenCalled();
  });

  it('detaches the purge when after() has no request scope', () => {
    mockAfter.mockImplementationOnce(() => {
      throw new Error('after() called outside a request scope');
    });

    scheduleStorefrontHostnamePurge('ogabassey');

    expect(mockPurgeCloudflareHostnamesConfirmed).toHaveBeenCalledWith([
      'ogabassey.com',
      'www.ogabassey.com',
    ]);
  });

  it('keeps the hostname purge promise alive for the post-response lifetime', async () => {
    let afterCallbackResult: unknown;
    mockAfter.mockImplementationOnce((callback: () => unknown) => {
      afterCallbackResult = callback();
    });

    scheduleStorefrontHostnamePurge('ogabassey');

    expect(afterCallbackResult).toBeInstanceOf(Promise);
    await expect(afterCallbackResult).resolves.toBeUndefined();
  });

  it('returns confirmation boolean in purgeStorefrontHostnameConfirmed', async () => {
    mockPurgeCloudflareHostnamesConfirmed.mockResolvedValueOnce({
      ok: true,
      reason: 'purged',
    } as never);
    await expect(purgeStorefrontHostnameConfirmed('ogabassey')).resolves.toBe(
      true
    );

    mockPurgeCloudflareHostnamesConfirmed.mockResolvedValueOnce({
      ok: false,
      reason: 'provider_rejected',
    } as never);
    await expect(purgeStorefrontHostnameConfirmed('ogabassey')).resolves.toBe(
      false
    );
  });
});
