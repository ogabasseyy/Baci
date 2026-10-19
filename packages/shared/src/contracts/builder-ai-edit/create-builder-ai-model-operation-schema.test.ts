import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import { createBuilderAiModelOperationSchema } from './create-builder-ai-model-operation-schema';

describe('createBuilderAiModelOperationSchema', () => {
  it('compiles carousel and theme fields from the supplied manifest', () => {
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
    manifest.themeTokenKeys.push('surface');
    const schema = createBuilderAiModelOperationSchema(manifest);

    expect(
      schema.safeParse({
        componentId: 'carousel-1',
        eyebrow: 'New season',
        kind: 'update_carousel_slide',
        slideIndex: 0,
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        colors: { surface: '#123456' },
        kind: 'update_theme',
      }).success
    ).toBe(true);
  });

  it('uses custom insertability and property bounds for component operations', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    const button = manifest.components.find(
      ({ componentType }) => componentType === 'Button'
    );
    if (!button) throw new Error('Expected Button capability');
    button.aiInsertable = false;
    button.props.variant.enum = ['accent'];
    const schema = createBuilderAiModelOperationSchema(manifest);

    expect(
      schema.safeParse({
        initialContent: { componentType: 'Button' },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        componentId: 'button-1',
        kind: 'update_component',
        patch: { componentType: 'Button', variant: 'primary' },
      }).success
    ).toBe(false);
  });

  it('includes a custom insert-only capability while keeping it out of updates', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    const button = manifest.components.find(
      ({ componentType }) => componentType === 'Button'
    );
    if (!button) throw new Error('Expected Button capability');
    button.aiEditable = false;
    button.aiInsertable = true;
    const schema = createBuilderAiModelOperationSchema(manifest);

    expect(
      schema.safeParse({
        initialContent: { componentType: 'Button' },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        componentId: 'button-1',
        kind: 'update_component',
        patch: { componentType: 'Button', text: 'Updated' },
      }).success
    ).toBe(false);
  });

  it('accepts the safe live Button anchor default while rejecting unsafe links', () => {
    const schema = createBuilderAiModelOperationSchema();

    expect(
      schema.safeParse({
        initialContent: { componentType: 'Button', link: '#' },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        initialContent: {
          componentType: 'Button',
          link: 'javascript:alert(1)',
        },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      }).success
    ).toBe(false);
  });

  it('allows clearing optional copy while keeping required Feature copy nonempty', () => {
    const schema = createBuilderAiModelOperationSchema();

    expect(
      schema.safeParse({
        componentId: 'features-1',
        kind: 'update_component',
        patch: { componentType: 'Features', subtitle: '' },
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        componentId: 'features-1',
        kind: 'update_component',
        patch: {
          componentType: 'Features',
          features: [{ description: '', title: 'Shipping' }],
        },
      }).success
    ).toBe(false);
  });
});
