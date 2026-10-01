import type { BuilderData } from '@baci/shared/contracts';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export interface BuilderAiContentCollectionEntry {
  collection: string;
  content: BuilderAiComponent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponentList(value: unknown): value is BuilderAiComponent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (component) =>
        isRecord(component) &&
        typeof component.type === 'string' &&
        isRecord(component.props)
    )
  );
}

export function getBuilderAiContentCollectionEntries(
  config: BuilderData
): BuilderAiContentCollectionEntry[] {
  return [
    { collection: 'content', content: config.content },
    ...Object.entries(config.zones ?? {}).flatMap(([collection, content]) =>
      collection.length > 0 &&
      collection.length <= 120 &&
      isComponentList(content)
        ? [{ collection, content }]
        : []
    ),
  ];
}
