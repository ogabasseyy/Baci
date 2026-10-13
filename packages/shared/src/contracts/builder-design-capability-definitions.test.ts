import { describe, expect, it } from 'vitest';
import { builderDesignCapabilityDefinitions } from './builder-design-capability-definitions';

describe('builderDesignCapabilityDefinitions', () => {
  it('defines every component once with explicit render and placement policy', () => {
    const componentTypes = builderDesignCapabilityDefinitions.map(
      ({ componentType }) => componentType
    );

    expect(new Set(componentTypes).size).toBe(componentTypes.length);
    expect(builderDesignCapabilityDefinitions).toHaveLength(31);
    expect(
      builderDesignCapabilityDefinitions.every(
        ({ placement, renderable }) =>
          renderable &&
          (placement.kind === 'content' || placement.kind === 'fixed')
      )
    ).toBe(true);
  });

  it('keeps refused definitions protected, fixed, and relayable', () => {
    const refused = builderDesignCapabilityDefinitions.filter(
      (definition) => definition.refused
    );

    expect(refused.length).toBeGreaterThan(0);
    expect(
      refused.every(
        ({
          aiEditable,
          aiInsertable,
          placement,
          protected: isProtected,
          refusal,
        }) =>
          !aiEditable &&
          !aiInsertable &&
          isProtected &&
          placement.kind === 'fixed' &&
          Boolean(refusal?.code && refusal.message)
      )
    ).toBe(true);
  });

  it('publishes bounded carousel special operations and retained insert defaults', () => {
    const carousel = builderDesignCapabilityDefinitions.find(
      ({ componentType }) => componentType === 'HeroCarousel'
    );
    const hero = builderDesignCapabilityDefinitions.find(
      ({ componentType }) => componentType === 'Hero'
    );

    expect(carousel?.specialOperations?.updateCarouselSlide).toMatchObject({
      ctaLink: { type: 'safe-link' },
      title: { maximumLength: 120, type: 'string' },
    });
    expect(hero?.initialProps).toEqual({ headingLevel: 'h2' });
    expect(hero?.props.ctaText).toMatchObject({ default: 'Shop now' });
    expect(hero?.props.title).toMatchObject({
      default: 'Featured collection',
    });
  });
});
