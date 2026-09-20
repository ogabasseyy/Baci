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



// ---------- getClassifiedImageVerificationUrl ----------
describe('getClassifiedImageVerificationUrl', () => {
  it('uses the original CDN AVIF URL for pending derivative verification', () => {
    const result = getClassifiedImageVerificationUrl({
      source_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      verified_url: 'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
      status: 'pending_derivative',
    });

    expect(result).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif'
    );
  });

  it('keeps a verified URL for non-derivative candidates', () => {
    const result = getClassifiedImageVerificationUrl({
      source_url: 'https://example.com/products/phone.png',
      verified_url: 'https://store.example/products/phone.png',
      status: 'pending_verification',
    });

    expect(result).toBe('https://store.example/products/phone.png');
  });
});

// ---------- verifyRemoteImage ----------
describe('verifyRemoteImage', () => {
  it('rejects private destinations without issuing a request', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const result = await verifyRemoteImage('http://169.254.169.254/latest/meta-data', fetchFn);
    expect(result.status).toBe('invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects HTTP redirects instead of following them', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      fakeResponse({ ok: false, status: 302, headers: new Headers({ location: 'http://127.0.0.1' }) })
    );
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      publicLookup
    );
    expect(result.status).toBe('invalid');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://images.example.com/phone.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });
  let fetchMock: Mock<FetchFn>;

  beforeEach(() => {
    fetchMock = vi.fn<FetchFn>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks as verified when HEAD returns 200 with image/jpeg content-type', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    }));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png'
    );
    expect(result.verified_format).toBe('jpeg');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('marks as verified with png format for image/png', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
    }));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/game-covers/cyberpunk-2077.png',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(result.verified_format).toBe('png');
  });

  it('marks as verified with webp format for image/webp', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
    }));
    const result = await verifyRemoteImage(
      'https://example.com/photo.webp',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(result.verified_format).toBe('webp');
  });

  it('marks as missing when HEAD returns 404', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: false,
      status: 404,
      headers: new Headers(),
    }));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/missing-image.jpg',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('missing');
    expect(result.failure_reason).toContain('404');
  });

  it('marks as pending_verification on 5xx server error', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: false,
      status: 503,
      headers: new Headers(),
    }));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/game-covers/temp-error.png',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('503');
  });

  it('marks as pending_verification on 429 rate limit', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: false,
      status: 429,
      headers: new Headers(),
    }));
    const result = await verifyRemoteImage(
      'https://example.com/photo.jpg',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('429');
  });

  it('marks as missing on 403 forbidden (permanent denial)', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: false,
      status: 403,
      headers: new Headers(),
    }));
    const result = await verifyRemoteImage(
      'https://example.com/photo.jpg',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('missing');
    expect(result.failure_reason).toContain('403');
  });

  it('marks as pending_verification on fetch timeout/network error', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/game-covers/timeout.png',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('fetch failed');
  });

  it('marks as invalid when content-type is not an image', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    }));
    const result = await verifyRemoteImage(
      'https://ogabassey.com/not-an-image',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('text/html');
  });

  it('falls back to GET when HEAD returns 405', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({
        ok: false,
        status: 405,
        headers: new Headers(),
      }))
      .mockResolvedValueOnce(fakeResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      }));
    const result = await verifyRemoteImage(
      'https://example.com/photo.jpg',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.com/photo.jpg',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('handles non-Error throw gracefully', async () => {
    fetchMock.mockRejectedValue('string error');
    const result = await verifyRemoteImage(
      'https://example.com/photo.jpg',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('string error');
  });

  it('marks as invalid for unsupported image types like image/avif', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/avif' }),
    }));
    const result = await verifyRemoteImage(
      'https://example.com/photo.avif',
      fetchMock,
      publicLookup
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('image/avif');
  });

  it('rejects hostnames that resolve to private addresses without fetching', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => [{ address: '10.0.0.5', family: 4 }];
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('non-public address 10.0.0.5');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 resolutions by their embedded address', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => [{ address: '::ffff:7f00:1', family: 6 }];
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('non-public address ::ffff:7f00:1');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retries verification when DNS resolution fails', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => {
      throw new Error('ENOTFOUND images.example.com');
    };
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('DNS resolution failed');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches through the pinned dispatcher from the destination gate', async () => {
    const seen: unknown[] = [];
    const fetchFn = vi.fn<FetchFn>(async (input, init) => {
      seen.push(init);
      return fakeResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      });
    });
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ dispatcher: expect.anything() });
  });
});
