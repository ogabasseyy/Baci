import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import {
  builderAiModelPlanSchema,
  createBuilderAiModelOperationSchema,
  validateBuilderAiEditPlanLimits,
} from './index';

const heroPatch = {
  componentType: 'Hero',
  title: 'A better welcome',
};

const proposedPlan = {
  operations: [
    { componentId: 'hero-1', kind: 'update_component', patch: heroPatch },
  ],
  status: 'proposed',
  summary: 'Update the hero copy',
};

describe('builder AI edit closed model plan', () => {
  it('accepts a bounded named collection for first-content placements', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        operations: [
          {
            initialContent: { componentType: 'Text', content: 'Sidebar copy' },
            kind: 'insert_component',
            placement: { collection: 'aside', position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: 'Add sidebar copy',
      }).success
    ).toBe(true);
  });

  it('accepts a bounded proposed plan and a refusal with no operations', () => {
    expect(builderAiModelPlanSchema.safeParse(proposedPlan).success).toBe(true);
    expect(
      builderAiModelPlanSchema.safeParse({
        operations: [],
        reason: 'I cannot add executable code.',
        status: 'refused',
      }).success
    ).toBe(true);
  });

  it('rejects empty or overlong proposals and refusals with operations', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        summary: 'x'.repeat(241),
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        operations: [proposedPlan.operations[0]],
        reason: 'No.',
        status: 'refused',
      }).success
    ).toBe(false);
  });

  it('rejects unknown kinds, unknown patch keys, and empty editable patches', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [{ kind: 'rewrite_everything' }],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'hero-1',
            kind: 'update_component',
            patch: { ...heroPatch, backgroundImage: 'https://example.test/x' },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'hero-1',
            kind: 'update_component',
            patch: { componentType: 'Hero' },
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects CodeEmbed inserts and field overages', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            initialContent: { code: '<script>', componentType: 'CodeEmbed' },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'hero-1',
            kind: 'update_component',
            patch: { componentType: 'Hero', ctaLink: 'x'.repeat(513) },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'hero-1',
            kind: 'update_component',
            patch: { componentType: 'Hero', subtitle: 'x'.repeat(2001) },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'header-1',
            kind: 'update_component',
            patch: {
              componentType: 'Header',
              navigationLinks: Array.from({ length: 9 }, () => ({
                label: 'Shop',
                url: '/shop',
              })),
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it('accepts only top-level bounded carousel slide edits', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'carousel-1',
            ctaText: 'Shop now',
            kind: 'update_carousel_slide',
            slideIndex: 0,
            title: 'New arrivals',
          },
        ],
      }).success
    ).toBe(true);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'carousel-1',
            kind: 'update_carousel_slide',
            patch: { title: 'New arrivals' },
            slideIndex: 0,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: [
          {
            componentId: 'carousel-1',
            image: 'unreviewed-asset',
            kind: 'update_carousel_slide',
            slideIndex: 0,
          },
        ],
      }).success
    ).toBe(false);
  });

  it('parses a newly manifest-authorized carousel special field', () => {
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

    expect(
      createBuilderAiModelOperationSchema(manifest).safeParse({
        componentId: 'carousel-1',
        eyebrow: 'New season',
        kind: 'update_carousel_slide',
        slideIndex: 0,
      }).success
    ).toBe(true);
  });

  it('limits a plan to 20 operations and five inserts', () => {
    const operation = proposedPlan.operations[0];
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: Array.from({ length: 21 }, () => operation),
      }).success
    ).toBe(false);
    const sixInserts = Array.from({ length: 6 }, () => ({
      initialContent: { componentType: 'Text', content: 'A short note' },
      kind: 'insert_component',
      placement: { position: 'first_content' },
    }));
    expect(
      builderAiModelPlanSchema.safeParse({
        ...proposedPlan,
        operations: sixInserts,
      }).success
    ).toBe(false);
    expect(
      validateBuilderAiEditPlanLimits({
        ...proposedPlan,
        operations: sixInserts,
      }).success
    ).toBe(false);
  });
});
