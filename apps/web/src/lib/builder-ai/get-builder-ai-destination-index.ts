import type { BuilderData } from '@baci/shared/contracts';
import { findBuilderAiComponent } from './find-builder-ai-component';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export function getBuilderAiDestinationIndex(
  config: BuilderData,
  content: BuilderAiComponent[],
  placement: {
    collection?: string;
    componentId?: string;
    position: 'after' | 'first_content';
  },
  createError: (message: string) => Error
): number {
  const bounds = {
    first: content[0]?.type === 'Header' ? 1 : 0,
    last:
      content.at(-1)?.type === 'Footer' ? content.length - 1 : content.length,
  };
  const index =
    placement.position === 'first_content'
      ? bounds.first
      : (() => {
          const target = findBuilderAiComponent(
            config,
            placement.componentId ?? ''
          );
          if (!target) {
            throw createError('Component target was not found');
          }
          if (target.content !== content) {
            throw createError('Placement crosses a zone boundary');
          }
          return target.index + 1;
        })();
  if (index < bounds.first || index > bounds.last) {
    throw createError('Placement crosses a protected anchor');
  }
  return index;
}
