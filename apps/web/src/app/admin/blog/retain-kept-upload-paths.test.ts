import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retainKeptUploadPaths } from './retain-kept-upload-paths';

const live = 'https://cdn.example.com/media/platform/blog/live.webp';
const kept = 'https://cdn.example.com/media/platform/blog/kept.webp';

describe('retainKeptUploadPaths', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('trims results to their kept paths', () => {
    expect(
      retainKeptUploadPaths(
        { url: live, variants: { thumb: kept }, width: 8 },
        new Set(['platform/blog/kept.webp'])
      )
    ).toEqual({ url: '', variants: { thumb: kept }, width: 8 });
  });

  it('returns null when nothing is kept', () => {
    expect(
      retainKeptUploadPaths({ url: live }, new Set(['platform/blog/kept.webp']))
    ).toBeNull();
  });
});
