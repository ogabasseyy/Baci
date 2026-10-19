import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropKeptUploadPaths } from './drop-kept-upload-paths';

const live = 'https://cdn.example.com/media/platform/blog/live.webp';
const kept = 'https://cdn.example.com/media/platform/blog/kept.webp';

describe('dropKeptUploadPaths', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('trims results to their unkept paths', () => {
    expect(
      dropKeptUploadPaths(
        { url: live, variants: { thumb: kept }, width: 8 },
        new Set(['platform/blog/kept.webp'])
      )
    ).toEqual({ url: live, variants: {}, width: 8 });
  });

  it('returns null when everything is kept', () => {
    expect(
      dropKeptUploadPaths({ url: kept }, new Set(['platform/blog/kept.webp']))
    ).toBeNull();
  });
});
