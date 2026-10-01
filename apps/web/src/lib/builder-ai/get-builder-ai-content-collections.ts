import type { BuilderData } from '@baci/shared/contracts';
import { getBuilderAiContentCollectionEntries } from './get-builder-ai-content-collection-entries';

export type BuilderAiComponent = BuilderData['content'][number];

export function getBuilderAiContentCollections(
  config: BuilderData
): BuilderAiComponent[][] {
  return getBuilderAiContentCollectionEntries(config).map(
    ({ content }) => content
  );
}
