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
import { type FetchFn, verifyRemoteImage } from './gmc-feed-verifier';

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

// ---------- verifyRemoteImage: HTTP status mapping ----------
describe('verifyRemoteImage', () => {
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
});
