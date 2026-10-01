import type { BuilderData } from '@baci/shared/contracts';
import { hasDuplicateBuilderAiComponentIds } from './has-duplicate-builder-ai-component-ids';

export function assertBuilderAiUniqueIds(
  config: BuilderData,
  createError: new (message: string) => Error
): void {
  if (hasDuplicateBuilderAiComponentIds(config)) {
    throw new createError('Duplicate component id');
  }
}
