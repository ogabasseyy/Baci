import { describe, expect, it } from 'vitest';
import { getStatusDrawerSnapPoints } from './order-status-drawer-snap-points';

describe('getStatusDrawerSnapPoints', () => {
  it('offers an expanded snap point when the content is taller than the default', () => {
    const [initial, expanded] = getStatusDrawerSnapPoints(844, 8, 6);

    expect(initial).toBeGreaterThan(420);
    expect(expanded).toBe(844 - 8 - 24);
  });

  it('uses a single snap point when there is no room to expand', () => {
    expect(getStatusDrawerSnapPoints(500, 0, 6)).toEqual([476]);
  });

  it('never returns a negative height on a tiny window', () => {
    expect(getStatusDrawerSnapPoints(10, 20, 0)).toEqual([0]);
  });
});
