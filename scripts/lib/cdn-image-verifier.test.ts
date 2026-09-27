import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyCdnImage } from './cdn-image-verifier';

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
