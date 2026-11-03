/** Preserve the intentional background-only splash after Expo generates its template. */
function normalizeSplashStoryboard(storyboard) {
  const document = storyboard.document;
  for (const scene of document.scenes?.[0]?.scene ?? []) {
    for (const objects of scene.objects ?? []) {
      for (const controller of objects.viewController ?? []) {
        for (const view of controller.view ?? []) {
          if (view.$?.id !== 'EXPO-ContainerView') continue;
          view.color = [
            { $: { key: 'backgroundColor', name: 'SplashScreenBackground' } },
          ];
          for (const constraints of view.constraints ?? []) {
            constraints.constraint = (constraints.constraint ?? []).filter(
              ({ $: attributes }) =>
                attributes.firstItem !== 'EXPO-SplashScreen' &&
                attributes.secondItem !== 'EXPO-SplashScreen'
            );
          }
        }
      }
    }
  }
  document.resources ??= [{}];
  const resources = document.resources[0];
  resources.image = (resources.image ?? []).filter(
    ({ $: attributes }) => attributes.name !== 'SplashScreenLogo'
  );
  resources.namedColor = (resources.namedColor ?? []).filter(
    ({ $: attributes }) => attributes.name !== 'SplashScreenBackground'
  );
  resources.namedColor.push({
    $: { name: 'SplashScreenBackground' },
    color: [
      {
        $: {
          red: '0',
          green: '0',
          blue: '0',
          alpha: '1',
          colorSpace: 'custom',
          customColorSpace: 'sRGB',
        },
      },
    ],
  });
  return storyboard;
}
module.exports = { normalizeSplashStoryboard };
