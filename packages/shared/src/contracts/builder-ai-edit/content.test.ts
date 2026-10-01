import { describe, expect, it } from 'vitest';
import { componentPatchSchema, heroCarouselSlidePatchSchema } from './content';

describe('builder AI edit content patches', () => {
  it('accepts bounded copy patches and rejects protected Hero media', () => {
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Hero',
        title: 'New arrivals',
      }).success
    ).toBe(true);
    expect(
      componentPatchSchema.safeParse({
        backgroundImage: 'https://example.test/hero.jpg',
        componentType: 'Hero',
      }).success
    ).toBe(false);
  });

  it('keeps content components to safe semantic types', () => {
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Newsletter',
        title: 'Stay in touch',
      }).success
    ).toBe(true);
    expect(
      componentPatchSchema.safeParse({
        componentType: 'CodeEmbed',
        code: '<script>',
      }).success
    ).toBe(false);
  });

  it('rejects credential-bearing Hero and carousel links', () => {
    const credentialUrl = 'https://merchant:secret@example.test/private';

    expect(
      componentPatchSchema.safeParse({
        componentType: 'Hero',
        ctaLink: credentialUrl,
      }).success
    ).toBe(false);
    expect(
      heroCarouselSlidePatchSchema.safeParse({ ctaLink: credentialUrl }).success
    ).toBe(false);
  });

  it('matches the discrete Puck Features column options', () => {
    for (const columns of [2, 3, 4]) {
      expect(
        componentPatchSchema.safeParse({ componentType: 'Features', columns })
          .success
      ).toBe(true);
    }
    for (const columns of [1, 2.5]) {
      expect(
        componentPatchSchema.safeParse({ componentType: 'Features', columns })
          .success
      ).toBe(false);
    }
  });

  it('accepts the real default Features icon but rejects unknown icons', () => {
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Features',
        features: [
          {
            description: 'Available help when needed.',
            icon: 'headphones',
            title: 'Support',
          },
        ],
      }).success
    ).toBe(true);
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Features',
        features: [
          {
            description: 'Unknown icon values must not persist.',
            icon: 'not-in-the-registry',
            title: 'Unknown',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects duplicate Feature titles before they become React keys', () => {
    expect(
      componentPatchSchema.safeParse({
        componentType: 'Features',
        features: [
          { description: 'Fast shipping.', title: 'Delivery' },
          { description: 'Delivered anywhere.', title: 'Delivery' },
        ],
      }).success
    ).toBe(false);
  });
});
