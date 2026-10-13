import { builderAiFeatureIconNames } from './builder-ai-edit/feature-icons';
import { builderDesignCapabilities } from './builder-design-capabilities';
import type {
  BuilderDesignCapability,
  BuilderDesignProp,
} from './builder-design-capability-props';

const supportedDescriptorTypes = new Set([
  'array',
  'boolean',
  'enum',
  'feature-icon',
  'number',
  'object',
  'safe-link',
  'safe-media',
  'string',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\\')) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return false;
  }
  if (value.startsWith('/')) return !value.startsWith('//');
  if (value.startsWith('#')) return true;
  if (!value.toLowerCase().startsWith('https://')) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isDescriptorType(type: string): boolean {
  return supportedDescriptorTypes.has(type);
}

function isValueForProp(
  descriptor: BuilderDesignProp,
  value: unknown
): boolean {
  if (!isDescriptorType(descriptor.type)) return false;
  if (descriptor.enum) {
    return typeof value === 'string' && descriptor.enum.includes(value);
  }
  if (descriptor.type === 'boolean') return typeof value === 'boolean';
  if (descriptor.type === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (descriptor.minimum === undefined || value >= descriptor.minimum) &&
      (descriptor.maximum === undefined || value <= descriptor.maximum) &&
      (!descriptor.wholeNumber || Number.isInteger(value))
    );
  }
  if (descriptor.type === 'safe-link') {
    return (
      typeof value === 'string' &&
      (descriptor.maximumLength === undefined ||
        value.length <= descriptor.maximumLength) &&
      isSafeUrl(value)
    );
  }
  if (descriptor.type === 'safe-media') return false;
  if (descriptor.type === 'feature-icon') {
    return (
      typeof value === 'string' &&
      builderAiFeatureIconNames.some((icon) => icon === value)
    );
  }
  if (descriptor.type === 'string') {
    return (
      typeof value === 'string' &&
      (descriptor.required !== true || value.trim().length > 0) &&
      (descriptor.maximumLength === undefined ||
        value.length <= descriptor.maximumLength)
    );
  }
  if (descriptor.type === 'object') {
    return (
      isRecord(value) &&
      descriptor.item !== undefined &&
      isObjectForItem(descriptor.item, value)
    );
  }
  if (descriptor.type === 'array') {
    const item = descriptor.item;
    if (!Array.isArray(value) || !item) return false;
    if (
      (descriptor.minimumItems !== undefined &&
        value.length < descriptor.minimumItems) ||
      (descriptor.maximumItems !== undefined &&
        value.length > descriptor.maximumItems)
    ) {
      return false;
    }
    if (
      !value.every((entry) => isRecord(entry) && isObjectForItem(item, entry))
    ) {
      return false;
    }
    const uniqueBy = item.uniqueBy;
    return (
      uniqueBy === undefined ||
      new Set(value.map((item) => (item as Record<string, unknown>)[uniqueBy]))
        .size === value.length
    );
  }
  return false;
}

function isObjectForItem(
  item: NonNullable<BuilderDesignProp['item']>,
  value: Record<string, unknown>
): boolean {
  if (
    Object.keys(value).some(
      (key) => !Object.keys(item.properties).includes(key)
    )
  ) {
    return false;
  }
  return Object.entries(item.properties).every(([key, descriptor]) => {
    if (!Object.keys(value).includes(key)) return descriptor.required !== true;
    const member = value[key];
    return member !== undefined && isValueForProp(descriptor, member);
  });
}

function getCapability(
  componentType: string
): BuilderDesignCapability | undefined {
  return builderDesignCapabilities.components.find(
    (capability) => capability.componentType === componentType
  );
}

function getDefaults(componentType: string): Record<string, unknown> {
  const capability = getCapability(componentType);
  return Object.fromEntries([
    ...Object.entries(capability?.initialProps ?? {}),
    ...Object.entries(capability?.props ?? {}).flatMap(
      ([property, descriptor]) =>
        descriptor.default === undefined ? [] : [[property, descriptor.default]]
    ),
  ]);
}

function isPropValue(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  const descriptor = getCapability(componentType)?.props[property];
  return descriptor !== undefined && isValueForProp(descriptor, value);
}

function getSpecialProps(componentType: string, operation: string) {
  return getCapability(componentType)?.specialOperations?.[operation];
}

function isSpecialPropValue(
  componentType: string,
  operation: string,
  property: string,
  value: unknown
): boolean {
  const descriptor = getSpecialProps(componentType, operation)?.[property];
  return descriptor !== undefined && isValueForProp(descriptor, value);
}

export const builderDesignCapabilityAdapter = {
  getCapability,
  getDefaults,
  getSpecialProps,
  isDescriptorType,
  isPropValue,
  isSpecialPropValue,
  isSafeUrl,
};
