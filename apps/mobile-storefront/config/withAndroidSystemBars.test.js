const { applyAndroidSystemBarStyles } = require('./androidSystemBars');

function buildAndroidStyles(parent = 'Theme.ReactNative.AppCompat.Light') {
  return {
    resources: {
      $: {},
      style: [
        {
          $: { name: 'AppTheme', parent },
          item: [
            {
              $: { name: 'android:editTextBackground' },
              _: '@drawable/rn_edit_text_material',
            },
            { $: { name: 'android:windowLightNavigationBar' }, _: 'true' },
          ],
        },
      ],
    },
  };
}

describe('applyAndroidSystemBarStyles', () => {
  it('persists DayNight transparent system-bar styles through prebuild', () => {
    const androidStyles = applyAndroidSystemBarStyles(buildAndroidStyles());
    const appTheme = androidStyles.resources.style[0];

    expect(androidStyles.resources.$['xmlns:tools']).toBe(
      'http://schemas.android.com/tools'
    );
    expect(appTheme.$.parent).toBe('Theme.AppCompat.DayNight.NoActionBar');
    expect(
      appTheme.item.some(
        (item) => item.$.name === 'android:windowLightNavigationBar'
      )
    ).toBe(false);
    expect(appTheme.item).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $: { name: 'android:navigationBarColor' },
          _: '@android:color/transparent',
        }),
        expect.objectContaining({
          $: { name: 'android:statusBarColor' },
          _: '@android:color/transparent',
        }),
        expect.objectContaining({
          $: {
            name: 'android:enforceNavigationBarContrast',
            'tools:targetApi': 'q',
          },
          _: 'false',
        }),
      ])
    );
  });
});
