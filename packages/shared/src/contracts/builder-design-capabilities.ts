import { builderDesignCapabilityDefinitions } from './builder-design-capability-definitions';
import type { BuilderDesignCapability } from './builder-design-capability-props';
import { getBuilderDesignCapabilityHash } from './get-builder-design-capability-hash';

export type BuilderDesignCapabilityManifest = {
  capabilityHash: string;
  capabilityVersion: string;
  components: BuilderDesignCapability[];
  refusalCodes: Record<string, string>;
  themeTokenKeys: string[];
  version: string;
};

const capabilityInputs = {
  capabilityVersion: 'mobile-builder-v1',
  components: builderDesignCapabilityDefinitions,
  refusalCodes: {
    'data-behavior': 'Requires a catalog data-query review.',
    'data-collection': 'Requires a submission-flow review.',
    'external-navigation': 'Requires reviewed destinations.',
    'media-review': 'Requires an asset pipeline review.',
    'merchant-specific': 'Reserved for merchant-specific rendering.',
    'network-embed': 'Requires a network and sandbox review.',
    'renderer-review': 'Requires a renderer allowlist review.',
    'renderer-state': 'Requires client-state behavior review.',
    'unsafe-code': 'Custom code can bypass storefront safety controls.',
  },
  themeTokenKeys: [
    'primary',
    'secondary',
    'accent',
    'background',
    'foreground',
  ],
  version: '1',
};

export const builderDesignCapabilities: BuilderDesignCapabilityManifest = {
  ...capabilityInputs,
  capabilityHash: getBuilderDesignCapabilityHash(capabilityInputs),
};

export function getBuilderDesignCapabilityProviderBrief(
  manifest: BuilderDesignCapabilityManifest
): string {
  const affordances = manifest.components
    .filter(({ aiEditable, aiInsertable }) => aiEditable || aiInsertable)
    .map(
      ({ aiEditable, aiInsertable, componentType }) =>
        `${componentType}: ${aiInsertable ? 'insert and ' : ''}${aiEditable ? 'edit' : 'insert'}`
    );
  const boundaries = manifest.components
    .filter(({ refused }) => refused)
    .map(({ componentType, refusal }) => `${componentType}: ${refusal?.code}`);

  return `Creative affordances: ${affordances.join('; ')}. Allowed theme tokens: theme tokens: ${manifest.themeTokenKeys.join(', ')}. Refusal boundary: ${boundaries.join('; ')}.`;
}
