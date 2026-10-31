const { normalizeSplashStoryboard } = require('./normalize-splash-storyboard');
const withBackgroundOnlyIosSplash = require('./withBackgroundOnlyIosSplash');

jest.mock('@expo/config-plugins', () => ({
  withMod: jest.fn((config, mod) => ({ ...config, capturedMod: mod })),
}));
jest.mock('./normalize-splash-storyboard', () => ({
  normalizeSplashStoryboard: jest.fn((storyboard) => ({
    ...storyboard,
    normalized: true,
  })),
}));

it('registers an iOS splash mod that normalizes and returns its config', () => {
  const registered = withBackgroundOnlyIosSplash({ name: 'test' });
  expect(registered.capturedMod.platform).toBe('ios');
  expect(registered.capturedMod.mod).toBe('splashScreenStoryboard');
  const input = { modResults: { document: {} } };
  expect(registered.capturedMod.action(input)).toBe(input);
  expect(normalizeSplashStoryboard).toHaveBeenCalledWith({ document: {} });
  expect(input.modResults).toEqual({ document: {}, normalized: true });
});
