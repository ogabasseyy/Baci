import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUrl: vi.fn(),
  isCdn: vi.fn(),
  verifyCdn: vi.fn(),
  verifyRemote: vi.fn(),
}));

vi.mock('./gmc-feed-verifier', () => ({
  getClassifiedImageVerificationUrl: (...args: unknown[]) =>
    mocks.getUrl(...args),
  isCdnUrl: (...args: unknown[]) => mocks.isCdn(...args),
  verifyCdnImageWithTransformFallback: (...args: unknown[]) =>
    mocks.verifyCdn(...args),
  verifyRemoteImage: (...args: unknown[]) => mocks.verifyRemote(...args),
}));

import { verifyClassifiedImage } from './verify-classified-image';

describe('verifyClassifiedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits invalid classifications without probing', async () => {
    const result = await verifyClassifiedImage(
      {
        source_url: 'https://cdn.example.com/bad.jpg',
        status: 'invalid',
        failure_reason: 'not an image',
      } as never,
      '/cdn/base'
    );
    expect(result).toEqual({
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: 'not an image',
    });
    expect(mocks.verifyCdn).not.toHaveBeenCalled();
    expect(mocks.verifyRemote).not.toHaveBeenCalled();
  });

  it('dispatches CDN urls to the filesystem check', async () => {
    mocks.getUrl.mockReturnValue('https://cdn.example.com/a.jpg');
    mocks.isCdn.mockReturnValue(true);
    mocks.verifyCdn.mockResolvedValue({ status: 'verified' });
    const result = await verifyClassifiedImage(
      { source_url: 'a.jpg', status: 'pending' } as never,
      '/cdn/base'
    );
    expect(mocks.verifyCdn).toHaveBeenCalledWith(
      'https://cdn.example.com/a.jpg',
      '/cdn/base'
    );
    expect(mocks.verifyRemote).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'verified' });
  });

  it('dispatches absolute http urls to the remote probe', async () => {
    mocks.getUrl.mockReturnValue('https://store.example.com/a.jpg');
    mocks.isCdn.mockReturnValue(false);
    mocks.verifyRemote.mockResolvedValue({ status: 'verified' });
    const result = await verifyClassifiedImage(
      { source_url: 'a.jpg', status: 'pending' } as never,
      '/cdn/base'
    );
    expect(mocks.verifyRemote).toHaveBeenCalledWith(
      'https://store.example.com/a.jpg'
    );
    expect(mocks.verifyCdn).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'verified' });
  });

  it('marks unsupported urls invalid', async () => {
    mocks.getUrl.mockReturnValue('ftp://store.example.com/a.jpg');
    mocks.isCdn.mockReturnValue(false);
    const result = await verifyClassifiedImage(
      { source_url: 'a.jpg', status: 'pending' } as never,
      '/cdn/base'
    );
    expect(result.status).toBe('invalid');
    expect(mocks.verifyCdn).not.toHaveBeenCalled();
    expect(mocks.verifyRemote).not.toHaveBeenCalled();
  });
});
