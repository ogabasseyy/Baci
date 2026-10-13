import { resolveUpdateChannel } from './resolve-update-channel';

describe('resolveUpdateChannel', () => {
  it('uses a supported explicit update channel', () => {
    expect(
      resolveUpdateChannel({
        EXPO_UPDATE_CHANNEL: ' preview ',
      })
    ).toBe('preview');
  });

  it('ignores an unsupported explicit channel when a lower-priority channel is valid', () => {
    expect(
      resolveUpdateChannel({
        EXPO_UPDATE_CHANNEL: 'staging',
        EXPO_PUBLIC_ENV: 'preview',
        EAS_BUILD_PROFILE: 'development',
      })
    ).toBe('preview');
  });

  it('uses EXPO_PUBLIC_ENV when no explicit channel is configured', () => {
    expect(
      resolveUpdateChannel({
        EXPO_PUBLIC_ENV: 'development',
      })
    ).toBe('development');
  });

  it('uses EAS_BUILD_PROFILE when higher-priority inputs are absent', () => {
    expect(
      resolveUpdateChannel({
        EAS_BUILD_PROFILE: 'preview',
      })
    ).toBe('preview');
  });

  it('defaults to production when no channel inputs are configured', () => {
    expect(resolveUpdateChannel({})).toBe('production');
  });

  it('prioritizes the explicit channel over public env and build profile', () => {
    expect(
      resolveUpdateChannel({
        EAS_BUILD_PROFILE: 'production',
        EXPO_PUBLIC_ENV: 'development',
        EXPO_UPDATE_CHANNEL: 'preview',
      })
    ).toBe('preview');
  });
});
