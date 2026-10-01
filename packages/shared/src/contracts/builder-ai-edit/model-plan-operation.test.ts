import { describe, expect, it } from 'vitest';
import { builderAiModelOperationSchema } from './model-plan-operation';

describe('builderAiModelOperationSchema', () => {
  it('accepts a supported bounded operation and rejects an unknown kind', () => {
    expect(
      builderAiModelOperationSchema.safeParse({
        kind: 'update_root',
        title: 'New title',
      }).success
    ).toBe(true);
    expect(
      builderAiModelOperationSchema.safeParse({ kind: 'unknown' }).success
    ).toBe(false);
  });

  it('rejects an empty theme color patch without a preset', () => {
    expect(
      builderAiModelOperationSchema.safeParse({
        colors: {},
        kind: 'update_theme',
      }).success
    ).toBe(false);
  });

  it('enforces string boundaries for carousel and root-only operations', () => {
    const validUrl = `https://example.test/${'a'.repeat(491)}`;

    expect(
      builderAiModelOperationSchema.safeParse({
        kind: 'update_root',
        title: 'a'.repeat(120),
      }).success
    ).toBe(true);
    expect(
      builderAiModelOperationSchema.safeParse({
        kind: 'update_root',
        title: 'a'.repeat(121),
      }).success
    ).toBe(false);
    expect(
      builderAiModelOperationSchema.safeParse({
        componentId: 'carousel',
        ctaLink: validUrl,
        kind: 'update_carousel_slide',
        slideIndex: 0,
        subtitle: 'a'.repeat(2000),
        title: 'a'.repeat(120),
      }).success
    ).toBe(true);
    expect(
      builderAiModelOperationSchema.safeParse({
        componentId: 'carousel',
        ctaLink: `${validUrl}a`,
        kind: 'update_carousel_slide',
        slideIndex: 0,
      }).success
    ).toBe(false);
    expect(
      builderAiModelOperationSchema.safeParse({
        componentId: 'carousel',
        kind: 'update_carousel_slide',
        slideIndex: 0,
        subtitle: 'a'.repeat(2001),
      }).success
    ).toBe(false);
  });
});
