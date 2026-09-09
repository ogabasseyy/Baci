import { afterEach, describe, expect, it, vi } from 'vitest';
import { ogabasseyCwvRuntimeConfig } from './measure-ogabassey-cwv-runtime-config.mjs';

const { buildRunConfig } = ogabasseyCwvRuntimeConfig;
const ORIGINAL_ENV = { ...process.env };

describe('buildRunConfig', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllEnvs();
  });

  it('keeps PSI enabled by default and writes to a timestamped audit directory', () => {
    vi.stubEnv('OGABASSEY_CWV_PSI', '1');
    vi.stubEnv('OGABASSEY_CWV_DEBUGBEAR', '0');

    const config = buildRunConfig({
      auditId: '2026-06-29T00-00-00-000Z',
      repoRoot: '/repo',
    });

    expect(config.outputDir).toBe(
      '/repo/output/audits/ogabassey-cwv-2026-06-29T00-00-00-000Z'
    );
    expect(config.artifactFileName('summary.json')).toBe('summary.json');
    expect(config.shouldRunPsi).toBe(true);
    expect(config.shouldRunExternalProbes).toBe(true);
    expect(config.shouldRunDebugBear).toBe(false);
    expect(config.strategies).toEqual(['mobile', 'desktop']);
  });

  it('requires an explicit DebugBear device for stable browser user-agent tagging', () => {
    vi.stubEnv('DEBUGBEAR_PROJECT_ID', 'project-1');
    vi.stubEnv('DEBUGBEAR_API_KEY', 'project-key');
    vi.stubEnv('OGABASSEY_CWV_DEBUGBEAR', '1');

    const config = buildRunConfig({ auditId: 'audit-1', repoRoot: '/repo' });

    expect(config.shouldAttemptDebugBear).toBe(true);
    expect(config.shouldRunDebugBear).toBe(false);
    expect(config.debugBearRequiresConfiguredDeviceUserAgent).toBe(true);
    expect(config.hasConfiguredDebugBearDeviceUserAgent).toBe(false);
  });
});
