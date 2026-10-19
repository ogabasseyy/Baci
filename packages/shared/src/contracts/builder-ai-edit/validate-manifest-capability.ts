import { builderDesignCapabilityAdapter } from '../builder-design-capability-adapter';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyManifestProps(
  componentType: string,
  value: Record<string, unknown>
): boolean {
  const capability =
    builderDesignCapabilityAdapter.getCapability(componentType);
  return (
    capability !== undefined &&
    Object.entries(value).every(
      ([property, propValue]) =>
        property === 'componentType' ||
        (Object.keys(capability.props).includes(property) &&
          builderDesignCapabilityAdapter.isPropValue(
            componentType,
            property,
            propValue
          ))
    )
  );
}

function isComponentPatch(value: unknown): boolean {
  if (!isRecord(value) || typeof value.componentType !== 'string') return false;
  const capability = builderDesignCapabilityAdapter.getCapability(
    value.componentType
  );
  return (
    capability?.aiEditable === true &&
    Object.keys(value).some((property) => property !== 'componentType') &&
    hasOnlyManifestProps(value.componentType, value)
  );
}

function isInsert(value: unknown): boolean {
  if (!isRecord(value) || typeof value.componentType !== 'string') return false;
  const capability = builderDesignCapabilityAdapter.getCapability(
    value.componentType
  );
  return (
    capability?.aiInsertable === true &&
    hasOnlyManifestProps(value.componentType, value)
  );
}

function isInsertPlacement(
  componentType: string,
  collection: string | undefined,
  availableCollections: readonly string[]
): boolean {
  const capability =
    builderDesignCapabilityAdapter.getCapability(componentType);
  if (!capability?.aiInsertable || capability.placement.kind !== 'content') {
    return false;
  }
  const destination = collection ?? 'content';
  if (destination === 'content') {
    return capability.placement.allowedCollections.includes('content');
  }
  return (
    destination !== 'root' &&
    capability.placement.allowedCollections.includes('zones') &&
    availableCollections.includes(destination)
  );
}

export const manifestBuilderAiCapability = {
  isComponentPatch,
  isInsert,
  isInsertPlacement,
};
