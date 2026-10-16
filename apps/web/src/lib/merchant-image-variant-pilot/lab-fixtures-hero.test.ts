import { describe, expect, it } from 'vitest';
import {
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { labHeroSlides, labHeroSlot } from './lab-fixtures-hero';

describe('labHeroSlides', () => {
  it('mounts the binding on slide-0 with store-scoped hrefs', () => {
    const slides = labHeroSlides({
      arm: 'control',
      basePath: '/pilot-lab/store/ogabassey',
      slide0: {
        imageAlt: 'hero alt',
        imageUrl: 'http://localhost:3000/original.png',
        name: 'Launch',
      },
    });
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({
      id: 'lab-hero-slide-0',
      href: '/pilot-lab/store/ogabassey/lab-category/lab-hero-slide-0?arm=control',
      imageUrl: 'http://localhost:3000/original.png',
    });
  });

  it('adds the shared-original filler slide when provided', () => {
    const slides = labHeroSlides({
      arm: 'control',
      basePath: '/pilot-lab/store/ogabassey',
      slide0: {
        imageAlt: 'hero alt',
        imageUrl: 'http://localhost:3000/original.png',
        name: 'Launch',
      },
      slide1: {
        imageAlt: 'filler alt',
        imageUrl: 'http://localhost:3000/original.png',
        name: 'Launch Filler',
      },
    });
    expect(slides).toHaveLength(2);
    expect(slides[1]?.id).toBe('lab-hero-slide-1');
    expect(slides[1]?.imageUrl).toBe(slides[0]?.imageUrl);
    expect(slides[1]?.href).toBe(
      '/pilot-lab/store/ogabassey/lab-category/lab-hero-slide-1?arm=control'
    );
  });
});

describe('labHeroSlot', () => {
  it('pins the production hero geometry contract', () => {
    expect(labHeroSlot('hero alt')).toEqual({
      alt: 'hero alt',
      imageFit: 'contain',
      media: MOBILE_HERO_SOURCE_MEDIA,
      sizes: MOBILE_HERO_IMAGE_SIZES,
    });
  });
});
