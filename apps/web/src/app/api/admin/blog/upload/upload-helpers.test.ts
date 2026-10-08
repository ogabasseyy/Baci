import { describe, expect, it } from 'vitest';
import {
  FEATURED_ALLOWED_TYPES,
  getAllowedTypesForPurpose,
  parseDeleteRequestBody,
  resolveUploadPurpose,
} from './upload-helpers';

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
});
