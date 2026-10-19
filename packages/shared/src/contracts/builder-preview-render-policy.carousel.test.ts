import { describe, expect, it } from 'vitest';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

describe('preview render policy carousel assets', () => {
  it('projects a saved six-slide HeroCarousel to the preview slide bound', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [
        {
          props: {
            id: 'carousel-1',
            slides: Array.from({ length: 6 }, (_, index) => ({
              ctaLink: `/collections/slide-${index + 1}`,
              ctaText: `Shop slide ${index + 1}`,
              image: `/images/slide-${index + 1}.webp`,
              subtitle: `Supporting copy ${index + 1}`,
              title: `Slide ${index + 1}`,
            })),
          },
          type: 'HeroCarousel',
        },
      ],
      root: { props: { title: 'Home' } },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const slides = result.data.content[0]?.props.slides;
    expect(slides).toHaveLength(5);
    expect(slides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          image: '/placeholder.png',
          title: 'Slide 1',
        }),
        expect.objectContaining({
          image: '/placeholder.png',
          title: 'Slide 5',
        }),
      ])
    );
  });

  it('projects carousel slide text and links onto a local placeholder image', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [
        {
          props: {
            autoplayDelay: 5000,
            id: 'carousel-1',
            slides: [
              {
                ctaLink: '/collections/new',
                ctaText: 'Shop now',
                image: '/existing-merchant-image.webp',
                subtitle: 'Updated supporting copy',
                title: 'Updated title',
              },
            ],
          },
          type: 'HeroCarousel',
        },
      ],
      root: { props: { title: 'Home' } },
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.content[0]?.props.slides).toEqual([
        {
          ctaLink: '/collections/new',
          ctaText: 'Shop now',
          image: '/placeholder.png',
          subtitle: 'Updated supporting copy',
          title: 'Updated title',
        },
      ]);
  });

  it('rejects partial carousel slides before they can call scoped routing with undefined', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { id: 'carousel-1', slides: [{ title: 'Sale' }] },
            type: 'HeroCarousel',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(false);
  });

  it('accepts omitted optional slide fields while validating any provided values', () => {
    const candidate = (slide: Record<string, unknown>) =>
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { id: 'carousel-1', slides: [slide] },
            type: 'HeroCarousel',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success;

    expect(
      candidate({
        ctaText: 'Shop now',
        image: '/images/slide.webp',
        title: 'New collection',
      })
    ).toBe(true);
    expect(
      candidate({
        ctaLink: 'javascript:alert(1)',
        ctaText: 'Shop now',
        image: '/images/slide.webp',
        title: 'New collection',
      })
    ).toBe(false);
  });

  it('rejects a carousel slide without validated artwork', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: {
              id: 'carousel-1',
              slides: [
                {
                  ctaLink: '/collections/new',
                  ctaText: 'Shop now',
                  subtitle: 'Supporting copy',
                  title: 'New title',
                },
              ],
            },
            type: 'HeroCarousel',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(false);
  });

  it('projects HTTPS carousel assets while rejecting hostile links and unknown fields', () => {
    const candidate = (slide: Record<string, unknown>) =>
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { id: 'carousel-1', slides: [slide] },
            type: 'HeroCarousel',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success;
    const safeSlide = {
      ctaLink: '/collections/new',
      ctaText: 'Shop now',
      image: '/existing-merchant-image.webp',
      subtitle: 'Supporting copy',
      title: 'New title',
    };
    expect(
      candidate({ ...safeSlide, image: 'https://outside.test/image.webp' })
    ).toBe(true);
    expect(candidate({ ...safeSlide, image: 'javascript:alert(1)' })).toBe(
      false
    );
    expect(candidate({ ...safeSlide, ctaLink: 'javascript:alert(1)' })).toBe(
      false
    );
    expect(candidate({ ...safeSlide, trackingPixel: '/pixel.gif' })).toBe(
      false
    );
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { id: 'carousel-1', slides: [safeSlide], unreviewed: true },
            type: 'HeroCarousel',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(false);
  });
});
