import type { BuilderData } from '@baci/shared/contracts';
import { createBuilderComponentId } from './create-builder-component-id';

function withId(
  component: BuilderData['content'][number],
  createId: (componentType: string) => string,
  onIdReplaced?: (previousId: string, nextId: string) => void
): BuilderData['content'][number] {
  const id = component.props.id;
  if (
    typeof id === 'string' &&
    id === id.trim() &&
    id.length > 0 &&
    id.length <= 120
  ) {
    return component;
  }
  const nextId = createId(component.type);
  if (typeof id === 'string') onIdReplaced?.(id, nextId);
  return {
    ...component,
    props: { ...component.props, id: nextId },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponent(value: unknown): value is BuilderData['content'][number] {
  return (
    isRecord(value) && typeof value.type === 'string' && isRecord(value.props)
  );
}

function normalizeZoneComponent(
  value: unknown,
  createId: (componentType: string) => string,
  onIdReplaced?: (previousId: string, nextId: string) => void
): unknown {
  if (!isRecord(value) || typeof value.type !== 'string') return value;
  const component = {
    ...value,
    props: isRecord(value.props) ? value.props : {},
  } as BuilderData['content'][number];
  return withId(component, createId, onIdReplaced);
}

function rekeyZoneName(
  name: string,
  replacements: ReadonlyMap<string, string>
) {
  const separator = name.indexOf(':');
  if (separator < 1) return name;
  const replacement = replacements.get(name.slice(0, separator));
  return replacement ? `${replacement}${name.slice(separator)}` : name;
}

function getZoneParentIds(zones: BuilderData['zones']): Set<string> {
  return new Set(
    Object.keys(zones ?? {}).flatMap((name) => {
      const separator = name.indexOf(':');
      return separator < 1 ? [] : [name.slice(0, separator)];
    })
  );
}

export function normalizeBuilderAiComponentIds(
  config: BuilderData,
  createId: (componentType: string) => string = createBuilderComponentId
): BuilderData {
  const replacements = new Map<string, string>();
  const zoneParentIds = getZoneParentIds(config.zones);
  const rememberReplacement = (previousId: string, nextId: string) => {
    if (zoneParentIds.has(previousId) && !replacements.has(previousId)) {
      replacements.set(previousId, nextId);
    }
  };
  const content = config.content.map((component) =>
    withId(component, createId, rememberReplacement)
  );
  const normalizedZones = Object.entries(config.zones ?? {}).map(
    ([name, zone]) =>
      [
        name,
        Array.isArray(zone)
          ? zone.map((component) =>
              isComponent(component)
                ? withId(component, createId, rememberReplacement)
                : normalizeZoneComponent(
                    component,
                    createId,
                    rememberReplacement
                  )
            )
          : zone,
      ] as const
  );
  const zones = Object.fromEntries(
    normalizedZones.map(([name, zone]) => [
      rekeyZoneName(name, replacements),
      zone,
    ])
  );
  return {
    ...config,
    content,
    ...(config.zones ? { zones } : {}),
  };
}
