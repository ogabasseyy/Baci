import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveMerchant: vi.fn(),
  configuredSlug: vi.fn(),
}));

vi.mock('@/lib/agentic/agentic-merchant-slug', () => ({
  getConfiguredAgenticMerchantSlug: mocks.configuredSlug,
}));

vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolveMerchant,
}));

import { getRequestHost } from '@/lib/storefront-host';
import { resolveDeviceCheckStorefront } from './resolve-device-check-storefront';

function requestFor(host: string, origin?: string): Request {
  return new Request(`https://${host}/api/ai/grade-device`, {
    method: 'POST',
    headers: origin ? { origin } : {},
  });
}

function resolvedHost(): string {
  const { request } = mocks.resolveMerchant.mock.calls[0]?.[0] as {
    request: Request;
  };
  return getRequestHost(request);
}

describe('resolveDeviceCheckStorefront', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    mocks.configuredSlug.mockReset().mockReturnValue('ogabassey');
    mocks.resolveMerchant.mockReset().mockResolvedValue({
      success: true,
      identifier: 'ogabassey',
      merchant: { id: 'merchant-1', is_published: true },
    });
  });

  it('resolves a storefront host and passes the slug only as a fallback', async () => {
    const request = requestFor('ogabassey.com');

    expect(await resolveDeviceCheckStorefront(request, 'ogabassey')).toEqual({
      ok: true,
      merchantId: 'merchant-1',
    });
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackIdentifier: 'ogabassey',
        request,
        rootDomain: 'usebaci.com',
      })
    );
  });

  it('treats a Vercel preview host as a platform host so the slug applies', async () => {
    await resolveDeviceCheckStorefront(
      requestFor('baci-review-123.vercel.app'),
      'ogabassey'
    );

    expect(resolvedHost()).toBe('usebaci.com');
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('keeps host-first resolution for hosts that only resemble a preview', async () => {
    await resolveDeviceCheckStorefront(
      requestFor('shop.evil.vercel.app'),
      'ogabassey'
    );

    expect(resolvedHost()).toBe('shop.evil.vercel.app');
  });

  it('falls back to the server-configured store when the native app sends no slug', async () => {
    await resolveDeviceCheckStorefront(requestFor('usebaci.com'), null);

    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('gives a browser request without a slug no configured-store fallback', async () => {
    await resolveDeviceCheckStorefront(
      requestFor('usebaci.com', 'https://usebaci.com'),
      null
    );

    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: undefined })
    );
  });

  it('prefers the slug the page sent over the configured store', async () => {
    mocks.configuredSlug.mockReturnValue('other-store');

    await resolveDeviceCheckStorefront(requestFor('usebaci.com'), 'ogabassey');

    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('passes no fallback when nothing is configured', async () => {
    mocks.configuredSlug.mockReturnValue(undefined);

    await resolveDeviceCheckStorefront(requestFor('usebaci.com'), null);

    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: undefined })
    );
  });

  it('defaults the root domain when the public setting is blank', async () => {
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', '  ');

    await resolveDeviceCheckStorefront(requestFor('ogabassey.com'), null);

    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ rootDomain: 'usebaci.com' })
    );
  });

  it('returns the resolver failure unchanged', async () => {
    mocks.resolveMerchant.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Invalid storefront identifier',
    });

    expect(
      await resolveDeviceCheckStorefront(requestFor('usebaci.com'), 'bad slug')
    ).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid storefront identifier',
    });
  });

  it('treats an unpublished store as not found', async () => {
    mocks.resolveMerchant.mockResolvedValue({
      success: true,
      identifier: 'ogabassey',
      merchant: { id: 'merchant-1', is_published: false },
    });

    expect(
      await resolveDeviceCheckStorefront(requestFor('ogabassey.com'), null)
    ).toEqual({
      ok: false,
      status: 404,
      error: 'Device check is only available on storefront hosts',
    });
  });
});
