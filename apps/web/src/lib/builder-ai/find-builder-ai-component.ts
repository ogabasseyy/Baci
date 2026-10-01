import type { BuilderData } from '@baci/shared/contracts';
import {
  type BuilderAiComponent,
  getBuilderAiContentCollections,
} from './get-builder-ai-content-collections';
import { getBuilderComponentId } from './get-builder-component-id';

export function findBuilderAiComponent(
  config: BuilderData,
  id: string
): { content: BuilderAiComponent[]; index: number } | undefined {
  for (const content of getBuilderAiContentCollections(config)) {
    const index = content.findIndex(
      (component) => getBuilderComponentId(component) === id
    );
    if (index >= 0) return { content, index };
  }
  return undefined;
}
