import { getBuilderComponentId } from './get-builder-component-id';

export function getDuplicateBuilderAiComponentId(
  content: unknown[]
): string | undefined {
  const ids = new Set<string>();
  for (const component of content) {
    const id = getBuilderComponentId(component);
    if (!id) continue;
    if (ids.has(id)) return id;
    ids.add(id);
  }
  return undefined;
}
