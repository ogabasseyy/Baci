import { describe, expect, it, vi } from 'vitest';
import { createCommittedSnapshotStore } from './committed-snapshot-store';

describe('committed cart snapshot channel', () => {
  it('keeps the hydration snapshot while notifying subscribers of committed changes', () => {
    const initial = { items: 0 };
    const restored = { items: 2 };
    const store = createCommittedSnapshotStore(initial);
    const observations: number[] = [];
    store.subscribe(() => observations.push(store.getSnapshot().items));

    store.publish(restored);

    expect(observations).toEqual([2]);
    expect(store.getSnapshot()).toBe(restored);
    expect(store.getServerSnapshot()).toBe(initial);
  });

  it('does not notify for the same snapshot and stops notifying detached consumers', () => {
    const initial = { items: 0 };
    const store = createCommittedSnapshotStore(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.publish(initial);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    store.publish({ items: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().items).toBe(1);
  });
});
