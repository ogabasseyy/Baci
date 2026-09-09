import { describe, expect, it } from 'vitest';
import { ogabasseyCwvUtils } from './measure-ogabassey-cwv-utils.mjs';

const { buildOgaBasseyCwvConfigurationFailures } = ogabasseyCwvUtils;

describe('buildOgaBasseyCwvConfigurationFailures', () => {
  it('keeps target resolution failures and reports missing providers', () => {
    const failures = buildOgaBasseyCwvConfigurationFailures({
      shouldRunDebugBear: false,
      shouldRunPsi: false,
      targetResolutionFailures: [
        {
          label: 'blog-post-latest',
          message: 'missing blog post',
          source: 'target-resolution',
        },
      ],
      targets: [],
    });

    expect(failures.map((failure) => failure.label)).toEqual([
      'blog-post-latest',
      'measurement',
      'targets',
    ]);
    expect(failures[0]).toMatchObject({ message: 'missing blog post' });
  });

  it('reports explicit DebugBear configuration gaps', () => {
    const failures = buildOgaBasseyCwvConfigurationFailures({
      isDebugBearExplicitlyEnabled: true,
      shouldRunDebugBear: false,
      shouldRunPsi: true,
      targets: [{ label: 'home', url: 'https://ogabassey.com/' }],
    });

    expect(failures.map((failure) => failure.label)).toEqual([
      'debugbear',
      'debugbear-projects',
    ]);
    expect(failures.every(({ source }) => source === 'configuration')).toBe(
      true
    );
  });

  it('requires an explicit DebugBear device when stable browser UA tagging is required', () => {
    const failures = buildOgaBasseyCwvConfigurationFailures({
      debugBearApiKey: 'project-key',
      debugBearRequiresConfiguredDeviceUserAgent: true,
      hasConfiguredDebugBearDeviceUserAgent: false,
      hasDiscoverableDebugBearProject: true,
      isDebugBearExplicitlyEnabled: true,
      shouldAttemptDebugBear: true,
      shouldRunDebugBear: false,
      shouldRunPsi: true,
      targets: [{ label: 'home', url: 'https://ogabassey.com/' }],
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'debugbear-device-user-agent',
          message: expect.stringContaining('cannot set a browser user-agent'),
          source: 'configuration',
        }),
      ])
    );
  });
});
