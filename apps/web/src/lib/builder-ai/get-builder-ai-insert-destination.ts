import {
  type BuilderAiModelOperation,
  type BuilderData,
  manifestBuilderAiCapability,
} from '@baci/shared/contracts';
import { findBuilderAiComponent } from './find-builder-ai-component';
import { getBuilderAiContentCollectionEntries } from './get-builder-ai-content-collection-entries';
import { getBuilderAiFirstContentDestination } from './get-builder-ai-first-content-destination';

type InsertPlacement = Extract<
  BuilderAiModelOperation,
  { kind: 'insert_component' }
>['placement'];

export function getBuilderAiInsertDestination(
  config: BuilderData,
  componentType: string,
  placement: InsertPlacement,
  ErrorType: new (message: string) => Error
) {
  const collectionEntries = getBuilderAiContentCollectionEntries(config);
  const afterTarget =
    placement.position === 'after'
      ? findBuilderAiComponent(config, placement.componentId)
      : undefined;
  if (placement.position === 'after' && !afterTarget) {
    throw new ErrorType('Component target was not found');
  }
  const collection =
    placement.position === 'first_content'
      ? (placement.collection ?? 'content')
      : collectionEntries.find(
          (entry) => entry.content === afterTarget?.content
        )?.collection;
  if (
    !manifestBuilderAiCapability.isInsertPlacement(
      componentType,
      collection,
      collectionEntries.map((entry) => entry.collection)
    )
  ) {
    throw new ErrorType('Placement is not allowed by manifest');
  }
  return {
    collection,
    content:
      afterTarget?.content ??
      getBuilderAiFirstContentDestination(config, collection, ErrorType),
  };
}
