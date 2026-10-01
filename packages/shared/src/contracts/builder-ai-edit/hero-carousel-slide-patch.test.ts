import { describe, expect, it } from 'vitest';
import { heroCarouselSlidePatchSchema } from './hero-carousel-slide-patch';

describe('heroCarouselSlidePatchSchema', () => {
  it('requires an editable carousel-slide field', () => {
    expect(heroCarouselSlidePatchSchema.safeParse({}).success).toBe(false);
    expect(
      heroCarouselSlidePatchSchema.safeParse({ title: 'Sale' }).success
    ).toBe(true);
  });
});
