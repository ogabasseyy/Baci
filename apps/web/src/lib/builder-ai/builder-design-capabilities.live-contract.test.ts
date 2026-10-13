import {
  builderAiEditContract,
  builderDesignCapabilities,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';
import { buildBuilderAiEditPrompt } from './build-builder-ai-edit-prompt';
import { getBuilderAiCatalogProjection } from './builder-ai-component-catalog-projection';
import { getBuilderAiSpecialOperationGuidance } from './get-builder-ai-special-operation-guidance';

function getAllowedComponentTypes(prompt: string): string[] {
  const guide = prompt.match(/<operation-guide>(.*)<\/operation-guide>/);
  if (!guide) throw new Error('Expected operation guide');
  return JSON.parse(guide[1]).allowedComponentTypes;
}

describe('builder design capability live contract', () => {
  it('projects every editable manifest descriptor into the live prompt catalog', () => {
    const catalog = getBuilderAiCatalogProjection();

    for (const capability of builderDesignCapabilities.components.filter(
      ({ aiEditable }) => aiEditable
    )) {
      const projected = catalog.find(
        ({ componentType }) => componentType === capability.componentType
      );
      expect(projected).toMatchObject({
        insertable: capability.aiInsertable,
        placement: capability.placement,
        protected: capability.protected,
      });
      expect(projected?.editableProps.map(({ name }) => name).sort()).toEqual(
        Object.keys(capability.props).sort()
      );
      for (const [name, descriptor] of Object.entries(capability.props)) {
        const prop = projected?.editableProps.find(
          (item) => item.name === name
        );
        expect(prop).toMatchObject({
          ...(descriptor.enum ? { allowedValues: descriptor.enum } : {}),
          ...(descriptor.maximumLength
            ? { maximumLength: descriptor.maximumLength }
            : {}),
          ...(descriptor.minimumItems
            ? { minimumItems: descriptor.minimumItems }
            : {}),
          ...(descriptor.maximumItems
            ? { maximumItems: descriptor.maximumItems }
            : {}),
          ...(descriptor.item?.uniqueBy
            ? { uniqueBy: descriptor.item.uniqueBy }
            : {}),
        });
      }
    }
  });

  it('advertises HeroCarousel only through its bounded text-slide operation', () => {
    const carousel = getBuilderAiCatalogProjection().find(
      ({ componentType }) => componentType === 'HeroCarousel'
    );

    expect(carousel?.editableProps).toEqual([]);
    expect(getBuilderAiSpecialOperationGuidance()).toMatchObject({
      updateCarouselSlide: {
        ctaLink: { maximumLength: 512 },
        ctaText: { maximumLength: 120 },
        subtitle: { maximumLength: 2000 },
        title: { maximumLength: 120 },
      },
    });
  });

  it('advertises only components that the live model-plan executor accepts', () => {
    const prompt = buildBuilderAiEditPrompt({
      currentConfig: { content: [], root: { props: {} } },
      prompt: 'Make the storefront more compelling',
    });
    const advertised = builderDesignCapabilities.components
      .filter(({ aiEditable, aiInsertable }) => aiEditable || aiInsertable)
      .map(({ componentType }) => componentType);

    expect(advertised.sort()).toEqual(getAllowedComponentTypes(prompt).sort());
  });

  it.each([
    ['Button', { link: '/products', text: 'Shop now' }],
    ['Spacer', { height: 'medium' }],
    [
      'FAQ',
      {
        items: [
          { answer: 'Within three days.', question: 'When do you ship?' },
        ],
        title: 'Questions',
      },
    ],
  ])('accepts a bounded %s insert advertised by the manifest', (componentType, props) => {
    expect(
      builderAiEditContract.modelPlanSchema.safeParse({
        operations: [
          {
            initialContent: { componentType, ...props },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: `Add ${componentType}`,
      }).success
    ).toBe(true);
  });

  it.each([
    ['Button', { link: '/products', text: 'Shop now' }],
    ['Spacer', { height: 'medium' }],
    [
      'FAQ',
      {
        items: [
          { answer: 'Within three days.', question: 'When do you ship?' },
        ],
        title: 'Questions',
      },
    ],
  ])('executes a bounded %s insert advertised by the manifest', (componentType, props) => {
    const result = applyBuilderAiEditPlan(
      { content: [], root: { props: {} } },
      {
        operations: [
          {
            initialContent: { componentType, ...props },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: `Add ${componentType}`,
      } as never,
      () => `${componentType.toLowerCase()}-1`
    );

    expect(result.candidateConfig.content).toContainEqual(
      expect.objectContaining({ type: componentType })
    );
  });

  it('rejects LegalSection insertion because its renderer owns a top-level heading', () => {
    expect(
      builderAiEditContract.modelPlanSchema.safeParse({
        operations: [
          {
            initialContent: {
              componentType: 'LegalSection',
              sections: [
                { content: 'We protect your data.', heading: 'Privacy' },
              ],
              title: 'Privacy policy',
            },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: 'Add LegalSection',
      }).success
    ).toBe(false);
  });

  it('uses the manifest safe Button link for a default-only insert', () => {
    const result = applyBuilderAiEditPlan(
      { content: [], root: { props: {} } },
      {
        operations: [
          {
            initialContent: { componentType: 'Button' },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: 'Add a button',
      } as never,
      () => 'button-1'
    );

    expect(result.candidateConfig.content).toContainEqual({
      props: expect.objectContaining({ id: 'button-1', link: '/' }),
      type: 'Button',
    });
  });
});
