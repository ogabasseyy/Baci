import { describe, expect, it } from 'vitest';
import {
  initialPreviewSlots,
  reducePreviewSlots,
} from './native-preview-slots';

describe('preview slot promotion', () => {
  it('keeps the last good preview after a candidate times out, including a late success', () => {
    let state = reducePreviewSlots(initialPreviewSlots, {
      type: 'start',
      slot: 1,
    });
    state = reducePreviewSlots(state, { type: 'rendered', slot: 1 });
    state = reducePreviewSlots(state, { type: 'start', slot: 2 });
    state = reducePreviewSlots(state, { type: 'failed', slot: 2 });
    state = reducePreviewSlots(state, { type: 'rendered', slot: 2 });
    expect(state.visible).toBe(1);
    expect(state.pending).toBeNull();
    expect(state.failed).toBe(2);
  });

  it('cannot promote an old candidate after a newer revision starts', () => {
    let state = reducePreviewSlots(initialPreviewSlots, {
      type: 'start',
      slot: 1,
    });
    state = reducePreviewSlots(state, { type: 'start', slot: 2 });
    state = reducePreviewSlots(state, { type: 'rendered', slot: 1 });
    expect(state.visible).toBeNull();
    expect(state.pending).toBe(2);
    state = reducePreviewSlots(state, { type: 'rendered', slot: 2 });
    expect(state.visible).toBe(2);
  });
});
