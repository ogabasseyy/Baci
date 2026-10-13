import {
  resolveAndroidVersionCode,
  resolveAppVersion,
  resolveIosBuildNumber,
} from './resolve-app-versions';

describe('resolveAndroidVersionCode', () => {
  it('accepts a positive integer version code', () => {
    expect(resolveAndroidVersionCode('640')).toBe(640);
  });

  it('ignores non-integer, non-positive, and out-of-range values', () => {
    expect(resolveAndroidVersionCode('2.5')).toBeUndefined();
    expect(resolveAndroidVersionCode('0')).toBeUndefined();
    expect(resolveAndroidVersionCode('-1')).toBeUndefined();
    expect(resolveAndroidVersionCode('2100000001')).toBeUndefined();
  });
});

describe('resolveIosBuildNumber', () => {
  it('stringifies a positive integer build number', () => {
    expect(resolveIosBuildNumber('364')).toBe('364');
  });

  it('ignores invalid build numbers', () => {
    expect(resolveIosBuildNumber('0')).toBeUndefined();
    expect(resolveIosBuildNumber('abc')).toBeUndefined();
  });
});

describe('resolveAppVersion', () => {
  it('prefers APP_VERSION over IOS_APP_VERSION', () => {
    expect(
      resolveAppVersion({
        APP_VERSION: '2.0.640',
        IOS_APP_VERSION: '2.0.364',
      })
    ).toBe('2.0.640');
  });

  it('treats empty APP_VERSION as unset and falls back to IOS_APP_VERSION', () => {
    expect(
      resolveAppVersion({
        APP_VERSION: '',
        IOS_APP_VERSION: '2.0.364',
      })
    ).toBe('2.0.364');
  });

  it('rejects a non-semver app version', () => {
    expect(() => resolveAppVersion({ APP_VERSION: '2.0' })).toThrow(
      /Invalid app version/
    );
  });
});
