import type { BuilderData } from '@baci/shared/contracts';
import { getBuilderAiContentCollectionEntries } from './get-builder-ai-content-collection-entries';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export function getBuilderAiFirstContentDestination(
  config: BuilderData,
  collection: string | undefined,
  createError: new (message: string) => Error
): BuilderAiComponent[] {
  const destination = getBuilderAiContentCollectionEntries(config).find(
    (entry) => entry.collection === (collection ?? 'content')
  )?.content;
  if (!destination) {
    throw new createError('Placement collection was not found');
  }
  return destination;
}
