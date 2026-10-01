import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export function getBuilderAiInsertOffset(
  offsets: WeakMap<BuilderAiComponent[], Map<string, number>>,
  content: BuilderAiComponent[],
  placement:
    | { componentId: string; position: 'after' }
    | { collection?: string; position: 'first_content' }
): number {
  const key =
    placement.position === 'after'
      ? `after:${placement.componentId}`
      : 'first_content';
  const contentOffsets = offsets.get(content) ?? new Map<string, number>();
  offsets.set(content, contentOffsets);
  const offset = contentOffsets.get(key) ?? 0;
  contentOffsets.set(key, offset + 1);
  return offset;
}
