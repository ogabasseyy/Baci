import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from '../builder-design-capabilities';
import { getManifestNamedComponentPatchSchema } from './manifest-component-schema';

function capability(
  manifest: typeof builderDesignCapabilities,
  componentType: string
) {
  const result = manifest.components.find(
    (entry) => entry.componentType === componentType
  );
  if (!result) throw new Error(`Expected ${componentType} capability`);
  return result;
}

describe('getManifestNamedComponentPatchSchema', () => {
  it.each([
    ['Button', 'size', { componentType: 'Button', size: 'compact' }],
    ['Spacer', 'height', { componentType: 'Spacer', height: 'giant' }],
  ])('uses a manifest enum change for %s', (componentType, property, patch) => {
    const manifest = structuredClone(builderDesignCapabilities);
    capability(manifest, componentType).props[property].enum = [
      (patch as Record<string, string>)[property],
    ];

    expect(
      getManifestNamedComponentPatchSchema(componentType, manifest).safeParse(
        patch
      ).success
    ).toBe(true);
  });

  it.each([
    [
      'FAQ',
      'items',
      {
        componentType: 'FAQ',
        items: [
          { answer: 'One', question: 'One' },
          { answer: 'Two', question: 'Two' },
        ],
      },
    ],
    [
      'LegalSection',
      'title',
      { componentType: 'LegalSection', title: 'Policy' },
    ],
  ])('uses a manifest bound change for %s', (componentType, property, patch) => {
    const manifest = structuredClone(builderDesignCapabilities);
    const descriptor = capability(manifest, componentType).props[property];
    if (componentType === 'FAQ') descriptor.maximumItems = 1;
    else descriptor.maximumLength = 3;

    expect(
      getManifestNamedComponentPatchSchema(componentType, manifest).safeParse(
        patch
      ).success
    ).toBe(false);
  });
});
