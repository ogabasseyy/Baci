import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DestinationLookupFn as DnsLookupFn } from './remote-destination-gate';

// Keeps DNS hermetic while proving the default-forwarding contract: when a
// caller omits lookupFn, the gate must receive undefined (so it falls back
// to the production resolver) rather than a stale closure. The mock records
// what was forwarded and substitutes a public documentation IP.
const forwardedLookups: Array<DestinationLookupFn | undefined> = [];
vi.mock('./remote-destination-gate', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./remote-destination-gate')>();
  const publicLookup: DestinationLookupFn = async () => [
    { address: '93.184.216.1', family: 4 },
  ];
  return {
    ...actual,
    resolvePinnedDestination: (url: string, lookupFn?: DestinationLookupFn) => {
      forwardedLookups.push(lookupFn);
      return actual.resolvePinnedDestination(url, lookupFn ?? publicLookup);
    },
  };
});
import {
  type FetchFn,
  buildCdnTransformImageUrl,
  getClassifiedImageVerificationUrl,
  verifyCdnImageWithTransformFallback,
  verifyRemoteImage,
} from './gmc-feed-verifier';
import { verifyCdnImage } from './cdn-image-verifier';

/** Builds a partial Response matching only what verifyRemoteImage inspects. */
function fakeResponse(props: {
  ok: boolean;
  status: number;
  headers: Headers;
}): Response {
  return props as unknown as Response;
}

/** Resolves every hostname to a public documentation IP. */
const publicLookup: DnsLookupFn = async () => [
  { address: '93.184.216.1', family: 4 },
];

// ---------- verifyCdnImageWithTransformFallback ----------
describe('verifyCdnImageWithTransformFallback', () => {
  const cdnBasePath = '/home/bassey/baci-cdn/public';

  let existsSyncMock: Mock<(path: string) => boolean>;
  let fetchMock: Mock<FetchFn>;

  beforeEach(() => {
    existsSyncMock = vi.fn<(path: string) => boolean>();
    fetchMock = vi.fn<FetchFn>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a CDN JPEG transform URL from an AVIF source URL', () => {
    expect(
      buildCdnTransformImageUrl(
        'https://cdn.ogabassey.com/core-assets/products/phone.avif?v=1'
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=1200,quality=90,format=jpeg/core-assets/products/phone.avif?v=1'
    );
  });

  it('keeps the sidecar JPG result when the derivative file exists', async () => {
    existsSyncMock.mockReturnValue(true);

    const result = await verifyCdnImageWithTransformFallback(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock,
      fetchMock,
      publicLookup
    );

    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the CDN JPEG transformer when an AVIF sidecar JPG is missing', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      })
    );

    const result = await verifyCdnImageWithTransformFallback(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock,
      fetchMock,
      publicLookup
    );

    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/image/width=1200,quality=90,format=jpeg/core-assets/products/phone.avif'
    );
    expect(result.verified_format).toBe('jpeg');
  });

  it('falls back to pending_derivative when the CDN transformer is not verified', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
    );

    const result = await verifyCdnImageWithTransformFallback(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock,
      fetchMock,
      publicLookup
    );

    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
  });

  it('preserves pending_verification when the CDN transformer probe is transient', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 503,
        headers: new Headers(),
      })
    );

    const result = await verifyCdnImageWithTransformFallback(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock,
      fetchMock,
      publicLookup
    );

    expect(result.status).toBe('pending_verification');
    expect(result.verified_url).toBeNull();
    expect(result.failure_reason).toContain('503');
  });

  it('forwards an omitted lookupFn to the gate default', async () => {
    existsSyncMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      })
    );

    const result = await verifyCdnImageWithTransformFallback(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock,
      fetchMock
    );

    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/image/width=1200,quality=90,format=jpeg/core-assets/products/phone.avif'
    );
    expect(forwardedLookups[forwardedLookups.length - 1]).toBeUndefined();
  });
});
