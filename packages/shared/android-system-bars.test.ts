import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyAndroidSystemBarStyles } = require('./android-system-bars.cjs');

describe('applyAndroidSystemBarStyles', () => {
  it('normalizes system bars and removes a forced light navigation bar idempotently', () => {
    const input = {
      resources: {
        $: {},
        style: [
          {
            $: { name: 'AppTheme', parent: 'old' },
            item: [
              { $: { name: 'android:windowLightNavigationBar' }, _: 'true' },
              { $: { name: 'android:navigationBarColor' }, _: 'black' },
            ],
          },
        ],
      },
    };
    expect(applyAndroidSystemBarStyles(input)).toBe(input);
    const theme = input.resources.style[0];
    expect(theme.$.parent).toBe('Theme.AppCompat.DayNight.NoActionBar');
    expect(input.resources.$).toEqual({
      'xmlns:tools': 'http://schemas.android.com/tools',
    });
    expect(theme.item).toEqual(
      expect.arrayContaining([
        {
          $: { name: 'android:navigationBarColor' },
          _: '@android:color/transparent',
        },
        {
          $: { name: 'android:statusBarColor' },
          _: '@android:color/transparent',
        },
        {
          $: {
            name: 'android:enforceNavigationBarContrast',
            'tools:targetApi': 'q',
          },
          _: 'false',
        },
      ])
    );
    expect(
      theme.item.some(
        (item) => item.$.name === 'android:windowLightNavigationBar'
      )
    ).toBe(false);
    const snapshot = structuredClone(input);
    applyAndroidSystemBarStyles(input);
    expect(input).toEqual(snapshot);
  });

  it('leaves malformed input or missing AppTheme unchanged', () => {
    const empty = {};
    expect(applyAndroidSystemBarStyles(empty)).toBe(empty);
    const input = {
      resources: { style: [{ $: { name: 'Other' }, item: [] }] },
    };
    applyAndroidSystemBarStyles(input);
    expect(input.resources.style[0]).toEqual({
      $: { name: 'Other' },
      item: [],
    });
  });
});
