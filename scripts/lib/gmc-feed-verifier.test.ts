import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DnsLookupFn,
  type FetchFn,
  buildCdnTransformImageUrl,
  getClassifiedImageVerificationUrl,
  verifyCdnImage,
  verifyCdnImageWithTransformFallback,
  verifyRemoteImage,
} from './gmc-feed-verifier';

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

// ---------- verifyCdnImage ----------
describe('verifyCdnImage', () => {
  const cdnBasePath = '/home/bassey/baci-cdn/public';

  let existsSyncMock: Mock<(path: string) => boolean>;

  beforeEach(() => {
    existsSyncMock = vi.fn<(path: string) => boolean>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks CDN JPG as verified when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
    expect(existsSyncMock).toHaveBeenCalledWith(
      '/home/bassey/baci-cdn/public/core-assets/products/phone.jpg'
    );
  });

  it('marks CDN JPG as missing when file does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('missing');
    expect(result.verified_url).toBeNull();
    expect(result.failure_reason).toContain('not found');
  });

  it('marks CDN PNG as verified when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/tablet.png',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(result.verified_format).toBe('png');
  });

  it('marks CDN WebP as verified when file exists', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/photo.webp',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(result.verified_format).toBe('webp');
  });

  it('verifies AVIF by checking sibling .jpg — marks verified when JPG exists', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
    expect(existsSyncMock).toHaveBeenCalledWith(
      '/home/bassey/baci-cdn/public/core-assets/products/phone.jpg'
    );
  });

  it('marks AVIF as pending_derivative when sibling .jpg does not exist', () => {
    existsSyncMock.mockReturnValue(false);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('pending_derivative');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
  });

  it('handles AVIF CDN URL with query string — checks JPG path, drops query from URL', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/phone.avif?v=1',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(result.verified_url).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
    expect(result.verified_format).toBe('jpeg');
    // Should check the filesystem path without query string
    expect(existsSyncMock).toHaveBeenCalledWith(
      '/home/bassey/baci-cdn/public/core-assets/products/phone.jpg'
    );
  });

  it('returns invalid for malformed CDN URL', () => {
    const result = verifyCdnImage(
      'not-a-valid-url',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('Invalid URL');
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it('normalizes path traversal attempts via URL parsing', () => {
    // new URL() normalizes ../../ — the pathname becomes /etc/passwd
    // which resolves to cdnBasePath/etc/passwd (within the CDN root)
    existsSyncMock.mockReturnValue(false);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/../../etc/passwd',
      cdnBasePath,
      existsSyncMock
    );
    // URL parser normalizes, so it's treated as a normal missing file
    expect(result.status).toBe('missing');
    expect(existsSyncMock).toHaveBeenCalledWith(
      '/home/bassey/baci-cdn/public/etc/passwd'
    );
  });

  it('handles nested CDN paths correctly', () => {
    existsSyncMock.mockReturnValue(true);
    const result = verifyCdnImage(
      'https://cdn.ogabassey.com/core-assets/products/gaming/controller.jpg',
      cdnBasePath,
      existsSyncMock
    );
    expect(result.status).toBe('verified');
    expect(existsSyncMock).toHaveBeenCalledWith(
      '/home/bassey/baci-cdn/public/core-assets/products/gaming/controller.jpg'
    );
  });
});

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
});

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
});
