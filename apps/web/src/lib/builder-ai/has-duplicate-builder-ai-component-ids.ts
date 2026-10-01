import type { BuilderData } from '@baci/shared/contracts';
import { getBuilderAiContentCollections } from './get-builder-ai-content-collections';
import { getBuilderComponentId } from './get-builder-component-id';

export function hasDuplicateBuilderAiComponentIds(
  config: BuilderData
): boolean {
  const ids = new Set<string>();
  for (const content of getBuilderAiContentCollections(config)) {
    for (const component of content) {
      const id = getBuilderComponentId(component);
      if (id && ids.has(id)) return true;
      if (id) ids.add(id);
    }
  }
  return false;
}
