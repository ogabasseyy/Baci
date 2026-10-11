import { describe, expect, it } from 'vitest';
import { blogPostSchema, createPostSchema } from './blog';

const validPost = {
  title: 'Image dimensions',
  slug: 'image-dimensions',
  content: '<p>Article</p>',
  author_name: 'Editorial',
};

describe.each([
  ['create', createPostSchema],
  ['update', blogPostSchema],
] as const)('%s image dimension validation', (_, schema) => {
  describe.each([
    'featured_image_width',
    'featured_image_height',
  ] as const)('%s', (field) => {
    it.each([
      1,
      1200,
      2_147_483_647,
      null,
      undefined,
    ])('accepts a database-safe value %s', (dimension) => {
      expect(
        schema.safeParse({ ...validPost, [field]: dimension }).success
      ).toBe(true);
    });

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2_147_483_648,
      Number.MAX_SAFE_INTEGER,
      '1200',
    ])('rejects an invalid value %s', (dimension) => {
      const result = schema.safeParse({ ...validPost, [field]: dimension });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual([field]);
      }
    });
  });
});
