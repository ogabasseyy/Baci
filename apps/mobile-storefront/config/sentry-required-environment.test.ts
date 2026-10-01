import { isSentryConfigurationRequired } from './sentry-required-environment';

describe('isSentryConfigurationRequired', () => {
  it('does not require production secrets in a clean CI Jest environment', () => {
    const result = isSentryConfigurationRequired({
      CI: 'true',
      NODE_ENV: 'test',
    });

    expect(result).toBe(false);
  });

  it('requires Sentry configuration for EAS builds', () => {
    expect(
      isSentryConfigurationRequired({ EAS_BUILD: 'true', NODE_ENV: 'test' })
    ).toBe(true);
  });

  it('requires Sentry configuration for production builds', () => {
    expect(isSentryConfigurationRequired({ NODE_ENV: 'production' })).toBe(
      true
    );
  });

  it('requires Sentry configuration for non-test CI builds', () => {
    expect(
      isSentryConfigurationRequired({ CI: '1', NODE_ENV: 'development' })
    ).toBe(true);
  });

  it('keeps local development optional', () => {
    expect(isSentryConfigurationRequired({ NODE_ENV: 'development' })).toBe(
      false
    );
  });
});
