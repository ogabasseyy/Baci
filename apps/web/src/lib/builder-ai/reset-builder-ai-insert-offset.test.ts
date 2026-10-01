import { describe, expect, it } from 'vitest';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';
import { getBuilderAiInsertOffset } from './get-builder-ai-insert-offset';
import { resetBuilderAiInsertOffset } from './reset-builder-ai-insert-offset';

describe('resetBuilderAiInsertOffset', () => {
  it('clears only the moved anchor after-placement offset', () => {
    const offsets = new WeakMap<BuilderAiComponent[], Map<string, number>>();
    const content: BuilderAiComponent[] = [];

    getBuilderAiInsertOffset(offsets, content, {
      componentId: 'anchor',
      position: 'after',
    });
    resetBuilderAiInsertOffset(offsets, content, {
      componentId: 'anchor',
      position: 'after',
    });

    expect(
      getBuilderAiInsertOffset(offsets, content, {
        componentId: 'anchor',
        position: 'after',
      })
    ).toBe(0);
  });

  it('clears a first-content placement offset', () => {
    const offsets = new WeakMap<BuilderAiComponent[], Map<string, number>>();
    const content: BuilderAiComponent[] = [];

    getBuilderAiInsertOffset(offsets, content, { position: 'first_content' });
    resetBuilderAiInsertOffset(offsets, content, { position: 'first_content' });

    expect(
      getBuilderAiInsertOffset(offsets, content, { position: 'first_content' })
    ).toBe(0);
  });

  it('does not require offset state for an untracked placement', () => {
    const offsets = new WeakMap<BuilderAiComponent[], Map<string, number>>();

    expect(() =>
      resetBuilderAiInsertOffset(offsets, [], { position: 'first_content' })
    ).not.toThrow();
  });
});
