import { describe, expect, it } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import {
  type BlogPostMediaRow,
  blogPostRowReferencesPath,
  FEATURED_ALLOWED_TYPES,
  filterBlogMediaPathsWithoutPersistedReferences,
  getAllowedTypesForPurpose,
  parseDeleteRequestBody,
  resolveUploadPurpose,
} from './upload-helpers';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(
  result:
    | { data: BlogPostMediaRow[] | null; error: null }
    | { data: null; error: { message: string } }
    | { throws: true }
): ServerSupabaseClient {
  const terminal = () => {
    if ('throws' in result) return Promise.reject(new Error('down'));
    return Promise.resolve(
      result as {
        data: BlogPostMediaRow[] | null;
        error: { message: string } | null;
      }
    );
  };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ limit: terminal }) }) }),
    }),
  } as unknown as ServerSupabaseClient;
}

describe('upload helpers', () => {
  describe('resolveUploadPurpose', () => {
    it('defaults to inline when purpose is missing or invalid', () => {
      expect(resolveUploadPurpose(null)).toBe('inline');
      expect(resolveUploadPurpose('unexpected')).toBe('inline');
    });

    it('accepts featured purpose case-insensitively', () => {
      expect(resolveUploadPurpose('FEATURED')).toBe('featured');
    });
  });

  describe('getAllowedTypesForPurpose', () => {
    it('uses the featured image allowlist for featured uploads', () => {
      expect(getAllowedTypesForPurpose('featured')).toEqual(
        FEATURED_ALLOWED_TYPES
      );
      expect(getAllowedTypesForPurpose('featured')).not.toContain('image/gif');
    });
  });

  describe('parseDeleteRequestBody', () => {
    it('returns 400 when no path is provided', () => {
      const parsed = parseDeleteRequestBody({});

      expect(parsed.paths).toBeNull();
      expect(parsed.response?.status).toBe(400);
    });

    it('returns 403 for non-platform paths', () => {
      const parsed = parseDeleteRequestBody({
        path: 'merchant-1/blog/not-allowed.png',
      });

      expect(parsed.paths).toBeNull();
      expect(parsed.response?.status).toBe(403);
    });

    it('dedupes and returns managed platform blog paths', () => {
      const parsed = parseDeleteRequestBody({
        path: 'platform/blog/cover.png',
        variantPaths: [
          'platform/blog/cover.png',
          'platform/blog/cover/landscape_16x9.webp',
        ],
      });

      expect(parsed.response).toBeNull();
      expect(parsed.paths).toEqual([
        'platform/blog/cover.png',
        'platform/blog/cover/landscape_16x9.webp',
      ]);
    });
  });

  describe('blogPostRowReferencesPath', () => {
    it('matches paths across media-carrying columns', () => {
      const row = {
        author_image_url:
          'https://cdn.example.com/media/platform/blog/author.webp',
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
        excerpt: 'https://cdn.example.com/media/platform/blog/excerpt.webp',
        featured_image_url:
          'https://cdn.example.com/media/platform/blog/cover.webp',
      };
      expect(blogPostRowReferencesPath(row, 'platform/blog/kept.webp')).toBe(
        true
      );
      expect(blogPostRowReferencesPath(row, 'platform/blog/excerpt.webp')).toBe(
        true
      );
      expect(blogPostRowReferencesPath(row, 'platform/blog/cover.webp')).toBe(
        true
      );
      expect(blogPostRowReferencesPath(row, 'platform/blog/author.webp')).toBe(
        true
      );
      expect(blogPostRowReferencesPath(row, 'platform/blog/orphan.webp')).toBe(
        false
      );
    });

    it('matches paths inside variant maps and strings', () => {
      expect(
        blogPostRowReferencesPath(
          {
            featured_image_variants: {
              landscape_16x9:
                'https://cdn.example.com/media/platform/blog/kept/landscape_16x9.webp',
            },
          },
          'platform/blog/kept/landscape_16x9.webp'
        )
      ).toBe(true);
      expect(
        blogPostRowReferencesPath(
          {
            featured_image_variants:
              'https://cdn.example.com/media/platform/blog/raw.webp',
          },
          'platform/blog/raw.webp'
        )
      ).toBe(true);
      expect(blogPostRowReferencesPath({}, 'platform/blog/orphan.webp')).toBe(
        false
      );
    });
  });

  describe('filterBlogMediaPathsWithoutPersistedReferences', () => {
    it('splits referenced from unreferenced paths', async () => {
      const client = fakeClient({
        data: [
          {
            content:
              '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
          },
        ],
        error: null,
      });
      expect(
        await filterBlogMediaPathsWithoutPersistedReferences(client, [
          'platform/blog/kept.webp',
          'platform/blog/orphan.webp',
        ])
      ).toEqual({
        deletable: ['platform/blog/orphan.webp'],
        skipped: ['platform/blog/kept.webp'],
      });
    });

    it('returns null when the reference scan fails', async () => {
      expect(
        await filterBlogMediaPathsWithoutPersistedReferences(
          fakeClient({ data: null, error: { message: 'down' } }),
          ['platform/blog/orphan.webp']
        )
      ).toBeNull();
      expect(
        await filterBlogMediaPathsWithoutPersistedReferences(
          fakeClient({ throws: true }),
          ['platform/blog/orphan.webp']
        )
      ).toBeNull();
    });
  });
});
