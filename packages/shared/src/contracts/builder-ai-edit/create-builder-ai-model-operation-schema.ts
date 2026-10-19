import { z } from 'zod';
import type { BuilderDesignCapabilityManifest } from '../builder-design-capabilities';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import { getHeroCarouselSlidePatchFields } from './hero-carousel-slide-patch-fields';
import { getManifestComponentSchema } from './manifest-component-schema';

const boundedComponentId = z.string().trim().min(1).max(120);
const boundedCollection = z.string().trim().min(1).max(120);
const boundedTitle = z.string().trim().min(1).max(120);
const componentPlacementSchema = z.discriminatedUnion('position', [
  z.strictObject({
    collection: boundedCollection.optional(),
    position: z.literal('first_content'),
  }),
  z.strictObject({
    componentId: boundedComponentId,
    position: z.literal('after'),
  }),
]);
const removeComponentSchema = z.strictObject({
  componentId: boundedComponentId,
  kind: z.literal('remove_component'),
});
const moveComponentSchema = z.strictObject({
  componentId: boundedComponentId,
  destination: componentPlacementSchema,
  kind: z.literal('move_component'),
});
const updateRootSchema = z.strictObject({
  kind: z.literal('update_root'),
  title: boundedTitle,
});

function getThemeColorSchema(manifest: BuilderDesignCapabilityManifest) {
  return z.strictObject(
    Object.fromEntries(
      manifest.themeTokenKeys.map((token) => [
        token,
        z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      ])
    )
  );
}

export function createBuilderAiModelOperationSchema(
  manifest: BuilderDesignCapabilityManifest = builderDesignCapabilities
) {
  const updateComponentSchema = z.strictObject({
    componentId: boundedComponentId,
    kind: z.literal('update_component'),
    patch: getManifestComponentSchema('edit', manifest),
  });
  const insertComponentSchema = z.strictObject({
    initialContent: getManifestComponentSchema('insert', manifest),
    kind: z.literal('insert_component'),
    placement: componentPlacementSchema,
  });
  const updateCarouselSlideSchema = z
    .strictObject({
      componentId: boundedComponentId,
      ...getHeroCarouselSlidePatchFields(manifest),
      kind: z.literal('update_carousel_slide'),
      slideIndex: z.number().int().min(0).max(4),
    })
    .refine(
      (value) =>
        Object.keys(value).some(
          (key) => !['componentId', 'kind', 'slideIndex'].includes(key)
        ),
      'Expected at least one editable carousel slide field'
    );
  const updateThemeSchema = z
    .strictObject({
      colors: getThemeColorSchema(manifest).optional(),
      kind: z.literal('update_theme'),
      preset: z
        .enum(['modern', 'minimal', 'luxury', 'playful', 'bold', 'calm'])
        .optional(),
    })
    .refine(
      (value) =>
        value.preset !== undefined ||
        Object.keys(value.colors ?? {}).length > 0,
      'Expected a visual preset or base colors'
    );
  return z.discriminatedUnion('kind', [
    updateComponentSchema,
    updateCarouselSlideSchema,
    insertComponentSchema,
    removeComponentSchema,
    moveComponentSchema,
    updateThemeSchema,
    updateRootSchema,
  ]);
}
