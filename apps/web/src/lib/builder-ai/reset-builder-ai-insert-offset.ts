import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export function resetBuilderAiInsertOffset(
  offsets: WeakMap<BuilderAiComponent[], Map<string, number>>,
  content: BuilderAiComponent[],
  placement:
    | { componentId: string; position: 'after' }
    | { collection?: string; position: 'first_content' }
): void {
  const key =
    placement.position === 'after'
      ? `after:${placement.componentId}`
      : 'first_content';
  offsets.get(content)?.delete(key);
}
