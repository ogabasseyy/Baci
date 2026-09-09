import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function wrapperEnv(outputDir) {
  const env = { ...process.env };
  delete env.OGABASSEY_CWV_TARGET_LABELS;
  delete env.OGABASSEY_CWV_DEBUGBEAR;
  delete env.OGABASSEY_CWV_PSI;
  delete env.OGABASSEY_CWV_SKIP_LATEST_BLOG_POST;
  return {
    ...env,
    DEBUGBEAR_ADMIN_API_KEY: '',
    DEBUGBEAR_API_KEY: '',
    DEBUGBEAR_PROJECT_ID: '',
    OGABASSEY_AUDIT_OUTPUT_DIR: outputDir,
    PAGESPEED_INSIGHTS_API_KEY: '',
    PSI_API_KEY: '',
  };
}

describe('measure-ogabassey-pdp-lcp CLI', () => {
  it('sets PDP-only DebugBear defaults without POSIX inline env syntax', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-pdp-lcp-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-pdp-lcp.mjs'
    );

    const env = wrapperEnv(outputDir);
    env.OGABASSEY_CWV_TARGET_LABELS = 'home';
    env.OGABASSEY_CWV_USE_PDP_LCP_URL = '0';
    env.OGABASSEY_PDP_LCP_URL = '';

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(result.stdout).not.toContain('┌');
    expect(summary.targets.map((target) => target.label)).toEqual(['pdp']);
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'debugbear',
          message: expect.stringContaining('explicitly enabled DebugBear'),
          source: 'configuration',
        }),
      ])
    );
  });

  it('preserves the legacy raw output directory and PDP default URL', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-pdp-raw-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-pdp-lcp.mjs'
    );
    const env = wrapperEnv(outputDir);
    delete env.OGABASSEY_AUDIT_OUTPUT_DIR;
    env.DEBUGBEAR_RAW_DIR = outputDir;

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.targets).toEqual([
      {
        label: 'pdp',
        url: 'https://ogabassey.com/laptops/lenovo-legion-pro-9-16irx9-rtx-4090',
      },
    ]);
  });

  it('lets apps/web .env.local override wrapper PDP defaults', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-pdp-env-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-pdp-lcp.mjs'
    );
    const envFile = join(outputDir, '.env.local');
    const env = wrapperEnv(outputDir);
    delete env.OGABASSEY_AUDIT_OUTPUT_DIR;
    delete env.DEBUGBEAR_RAW_DIR;

    await writeFile(
      envFile,
      [
        'OGABASSEY_PDP_LCP_URL=https://ogabassey.com/custom-pdp',
        `OGABASSEY_AUDIT_OUTPUT_DIR=${outputDir}`,
      ].join('\n')
    );

    env.OGABASSEY_CWV_APP_ENV_FILE = envFile;

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.targets).toEqual([
      { label: 'pdp', url: 'https://ogabassey.com/custom-pdp' },
    ]);
  });

  it('preserves /tmp as the legacy raw output directory when no raw dir is set', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-pdp-unused-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-pdp-lcp.mjs'
    );
    const env = wrapperEnv(outputDir);
    delete env.OGABASSEY_AUDIT_OUTPUT_DIR;
    delete env.DEBUGBEAR_RAW_DIR;

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Saved CWV audit artifacts to /tmp');
  });
});
