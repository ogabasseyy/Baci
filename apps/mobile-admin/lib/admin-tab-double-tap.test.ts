import { describe, expect, it } from 'vitest';
import { recordAdminTabPress } from './admin-tab-double-tap';

describe('recordAdminTabPress', () => {
  it('recognizes a second press on the focused tab within the window', () => {
    expect(
      recordAdminTabPress({ at: 100, routeKey: 'home' }, 'home', 400)
    ).toEqual({
      isDoubleTap: true,
      nextPress: { at: 0, routeKey: '' },
    });
  });

  it('starts a new sequence for a different tab or a late press', () => {
    expect(
      recordAdminTabPress({ at: 100, routeKey: 'home' }, 'orders', 200)
    ).toEqual({
      isDoubleTap: false,
      nextPress: { at: 200, routeKey: 'orders' },
    });
    expect(
      recordAdminTabPress({ at: 100, routeKey: 'home' }, 'home', 451)
    ).toEqual({
      isDoubleTap: false,
      nextPress: { at: 451, routeKey: 'home' },
    });
  });
});
