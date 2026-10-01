import { builderDesignCapabilityAdapter } from '@baci/shared/contracts';

export type BuilderAiPropShape =
  | 'feature-list'
  | 'faq-list'
  | 'legal-section-list'
  | 'link'
  | 'link-list'
  | 'primitive'
  | 'url';

export function getBuilderAiPropShape(
  componentType: string,
  property: string
): BuilderAiPropShape | undefined {
  const descriptor =
    builderDesignCapabilityAdapter.getCapability(componentType)?.props[
      property
    ];
  if (!descriptor) return undefined;
  if (descriptor.type === 'safe-link') return 'url';
  if (descriptor.type === 'object') return 'link';
  if (descriptor.type !== 'array') return 'primitive';
  const members = Object.keys(descriptor.item?.properties ?? {});
  if (members.includes('icon')) return 'feature-list';
  if (members.includes('question')) return 'faq-list';
  if (members.includes('heading')) return 'legal-section-list';
  return 'link-list';
}
