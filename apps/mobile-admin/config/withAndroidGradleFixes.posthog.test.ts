import { describe, expect, it } from 'vitest';

const ensurePostHogAndroidPlugin = require('./withAndroidGradleFixes.posthog');

describe('admin Android PostHog plugin', () => {
  it('adds the native-symbol plugin once when PostHog tooling is enabled', () => {
    const source =
      'apply plugin: "com.android.application"\napply from: "posthog.gradle"\n';
    const updated = ensurePostHogAndroidPlugin(source);
    expect(updated).toContain('apply plugin: "com.posthog.android"');
    expect(ensurePostHogAndroidPlugin(updated)).toBe(updated);
  });
  it('does not enable the plugin without PostHog tooling', () => {
    const source = 'apply plugin: "com.android.application"\n';
    expect(ensurePostHogAndroidPlugin(source)).toBe(source);
  });
  it('rejects an unexpected Gradle layout when injection is required', () => {
    expect(() =>
      ensurePostHogAndroidPlugin('apply from: "posthog.gradle"')
    ).toThrow();
  });
});
