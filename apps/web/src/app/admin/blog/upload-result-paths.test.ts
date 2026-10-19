import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadResultPaths } from './upload-result-paths';

const COVER = 'https://cdn.example.com/media/platform/blog/cover.webp';
const VARIANT =
  'https://cdn.example.com/media/platform/blog/cover/landscape_16x9.webp';

describe('uploadResultPaths', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('extracts the cover and variant paths', () => {
    expect(
      uploadResultPaths({ url: COVER, variants: { landscape_16x9: VARIANT } })
    ).toEqual([
      'platform/blog/cover.webp',
      'platform/blog/cover/landscape_16x9.webp',
    ]);
  });

  it('handles missing variants', () => {
    expect(uploadResultPaths({ url: COVER })).toEqual([
      'platform/blog/cover.webp',
    ]);
  });

  it('drops untrusted origins', () => {
    expect(
      uploadResultPaths({
        url: 'https://evil.example.com/media/platform/blog/cover.webp',
      })
    ).toEqual([]);
  });
});
