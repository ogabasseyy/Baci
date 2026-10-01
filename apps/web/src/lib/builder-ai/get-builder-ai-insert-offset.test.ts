import { describe, expect, it } from 'vitest';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';
import { getBuilderAiInsertOffset } from './get-builder-ai-insert-offset';

describe('getBuilderAiInsertOffset', () => {
  it('increments only repeated placements in the same collection', () => {
    const offsets = new WeakMap<BuilderAiComponent[], Map<string, number>>();
    const content: BuilderAiComponent[] = [];

    expect(
      getBuilderAiInsertOffset(offsets, content, {
        componentId: 'hero',
        position: 'after',
      })
    ).toBe(0);
    expect(
      getBuilderAiInsertOffset(offsets, content, {
        componentId: 'hero',
        position: 'after',
      })
    ).toBe(1);
    expect(
      getBuilderAiInsertOffset(offsets, content, { position: 'first_content' })
    ).toBe(0);
  });
});
