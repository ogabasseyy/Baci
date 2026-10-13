import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import {
  getHeroCarouselSlidePatchFields,
  heroCarouselSlidePatchFields,
} from './hero-carousel-slide-patch-fields';

describe('heroCarouselSlidePatchFields', () => {
  it('keeps only the supported carousel slide fields available to plan schemas', () => {
    expect(Object.keys(heroCarouselSlidePatchFields)).toEqual([
      'ctaLink',
      'ctaText',
      'subtitle',
      'title',
    ]);
  });

  it('allows optional subtitles but requires nonempty carousel CTA copy', () => {
    expect(heroCarouselSlidePatchFields.subtitle.safeParse('').success).toBe(
      true
    );
    expect(heroCarouselSlidePatchFields.ctaText.safeParse('').success).toBe(
      false
    );
  });

  it('still requires nonempty text when a manifest descriptor is required', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    const carousel = manifest.components.find(
      ({ componentType }) => componentType === 'HeroCarousel'
    );
    if (!carousel?.specialOperations?.updateCarouselSlide)
      throw new Error('Missing carousel contract');
    carousel.specialOperations.updateCarouselSlide.title.required = true;
    const fields = getHeroCarouselSlidePatchFields(manifest);
    expect(z.strictObject(fields).safeParse({ title: '' }).success).toBe(false);
    expect(z.strictObject(fields).safeParse({ title: 'Sale' }).success).toBe(
      true
    );
  });
});
