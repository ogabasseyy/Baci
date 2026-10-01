import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiSpecialOperationGuidance } from './get-builder-ai-special-operation-guidance';

describe('getBuilderAiSpecialOperationGuidance', () => {
  it('publishes all bounded special-operation strings', () => {
    expect(getBuilderAiSpecialOperationGuidance()).toEqual({
      updateCarouselSlide: {
        ctaLink: { maximumLength: 512, type: 'safe-link' },
        ctaText: { maximumLength: 120, required: true, type: 'string' },
        mediaMutation: {
          refusalCode: 'media-review',
          message: 'Requires an asset pipeline review.',
        },
        subtitle: { maximumLength: 2000, type: 'string' },
        title: { maximumLength: 120, required: true, type: 'string' },
      },
      updateRoot: { title: { maximumLength: 120 } },
    });
  });

  it('projects each manifest-authorized special field with its descriptor semantics', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    const carousel = manifest.components.find(
      ({ componentType }) => componentType === 'HeroCarousel'
    );
    if (!carousel?.specialOperations?.updateCarouselSlide) {
      throw new Error('Expected carousel special operation');
    }
    carousel.specialOperations.updateCarouselSlide.eyebrow = {
      maximumLength: 120,
      type: 'string',
    };

    expect(getBuilderAiSpecialOperationGuidance(manifest)).toMatchObject({
      updateCarouselSlide: {
        ctaLink: { maximumLength: 512, type: 'safe-link' },
        eyebrow: { maximumLength: 120, type: 'string' },
      },
    });
  });
});
