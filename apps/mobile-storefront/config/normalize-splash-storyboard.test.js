const { normalizeSplashStoryboard } = require('./normalize-splash-storyboard');

describe('background-only iOS splash', () => {
  it('preserves black branding and removes dangling Expo image constraints', () => {
    const view = {
      $: { id: 'EXPO-ContainerView' },
      subviews: [{}],
      color: [
        { $: { key: 'backgroundColor', systemColor: 'systemBackgroundColor' } },
      ],
      constraints: [
        {
          constraint: [
            { $: { firstItem: 'EXPO-SplashScreen' } },
            { $: { firstItem: 'EXPO-ContainerView', firstAttribute: 'width' } },
          ],
        },
      ],
    };
    const storyboard = {
      document: {
        scenes: [
          { scene: [{ objects: [{ viewController: [{ view: [view] }] }] }] },
        ],
        resources: [{ image: [{ $: { name: 'SplashScreenLogo' } }] }],
      },
    };
    normalizeSplashStoryboard(storyboard);
    expect(view.color).toEqual([
      { $: { key: 'backgroundColor', name: 'SplashScreenBackground' } },
    ]);
    expect(view.constraints[0].constraint).toEqual([
      { $: { firstItem: 'EXPO-ContainerView', firstAttribute: 'width' } },
    ]);
    expect(storyboard.document.resources[0].image).toEqual([]);
    expect(storyboard.document.resources[0].namedColor[0].$.name).toBe(
      'SplashScreenBackground'
    );
    const normalized = JSON.parse(JSON.stringify(storyboard));
    expect(normalizeSplashStoryboard(storyboard)).toEqual(normalized);
  });
});
