import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unreferencedUploadPaths } from './unreferenced-upload-paths';

const live = 'https://cdn.example.com/media/platform/blog/live.webp';
const kept = 'https://cdn.example.com/media/platform/blog/kept.webp';

describe('unreferencedUploadPaths', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('returns source and variant paths missing from keepPaths', () => {
    expect(
      unreferencedUploadPaths(
        { url: live, variants: { thumb: kept } },
        new Set(['platform/blog/kept.webp'])
      )
    ).toEqual(['platform/blog/live.webp']);
  });

  it('drops unmanaged urls', () => {
    expect(
      unreferencedUploadPaths(
        { url: 'https://evil.example.com/x.webp' },
        new Set()
      )
    ).toEqual([]);
  });
});
