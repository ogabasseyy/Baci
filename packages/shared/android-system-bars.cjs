const SYSTEM_BAR_ITEMS = [
  {
    name: 'android:navigationBarColor',
    value: '@android:color/transparent',
  },
  {
    name: 'android:statusBarColor',
    value: '@android:color/transparent',
  },
  {
    attrs: { 'tools:targetApi': 'q' },
    name: 'android:enforceNavigationBarContrast',
    value: 'false',
  },
];

/**
 * Ensures Android resources can write tools-scoped attributes.
 *
 * @param {{ $?: Record<string, string> }} resources Expo Android styles resources object. Mutates resources.$.
 */
function ensureResourcesToolsNamespace(resources) {
  resources.$ = {
    ...(resources.$ ?? {}),
    'xmlns:tools': 'http://schemas.android.com/tools',
  };
}

/**
 * Inserts or updates a named Android style item.
 *
 * @param {{ item?: Array<{ $?: Record<string, string>, _?: string }> }} style Expo Android style object. Mutates style.item.
 * @param {{ attrs?: Record<string, string>, name: string, value: string }} item Style item definition.
 */
function upsertStyleItem(style, { attrs = {}, name, value }) {
  style.item ??= [];
  const existing = style.item.find((item) => item.$?.name === name);

  if (existing) {
    existing._ = value;
    existing.$ = {
      ...existing.$,
      ...attrs,
      name,
    };
    return;
  }

  style.item.push({
    $: { ...attrs, name },
    _: value,
  });
}

/**
 * Persists Baci's Android edge-to-edge system bar styles in Expo prebuild output.
 *
 * @param {{ resources?: { $?: Record<string, string>, style?: Array<{ $?: Record<string, string>, item?: Array<{ $?: Record<string, string>, _?: string }> }> } }} androidStyles Expo Android styles mod results.
 * @returns The same androidStyles object after in-place updates when AppTheme exists.
 */
function applyAndroidSystemBarStyles(androidStyles) {
  const resources = androidStyles.resources;
  if (!resources || !Array.isArray(resources.style)) {
    return androidStyles;
  }

  ensureResourcesToolsNamespace(resources);
  const appTheme = resources.style.find(
    (style) => style.$?.name === 'AppTheme'
  );
  if (!appTheme) {
    return androidStyles;
  }

  appTheme.$ = {
    ...appTheme.$,
    parent: 'Theme.AppCompat.DayNight.NoActionBar',
  };

  // Let the DayNight theme choose contrasting navigation icons.
  appTheme.item = (appTheme.item ?? []).filter(
    (item) => item.$?.name !== 'android:windowLightNavigationBar'
  );

  for (const item of SYSTEM_BAR_ITEMS) {
    upsertStyleItem(appTheme, item);
  }

  return androidStyles;
}

module.exports = {
  applyAndroidSystemBarStyles,
};
