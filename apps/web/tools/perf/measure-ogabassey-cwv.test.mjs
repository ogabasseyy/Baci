import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function scriptEnv(outputDir) {
  return {
    ...process.env,
    DEBUGBEAR_ADMIN_API_KEY: '',
    DEBUGBEAR_API_KEY: '',
    DEBUGBEAR_PROJECT_ID: '',
    OGABASSEY_AUDIT_OUTPUT_DIR: outputDir,
    OGABASSEY_CWV_DEBUGBEAR: '0',
    OGABASSEY_CWV_PSI: '0',
    OGABASSEY_CWV_SKIP_LATEST_BLOG_POST: '1',
    PAGESPEED_INSIGHTS_API_KEY: '',
    PSI_API_KEY: '',
  };
}

describe('measure-ogabassey-cwv CLI', () => {
  it('fails closed with a stable summary when no provider is scheduled', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-cwv-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-cwv.mjs'
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: scriptEnv(outputDir),
    });

    expect(result.status).toBe(1);
    const files = await readdir(outputDir);
    expect(files).toContain('summary.json');
    expect(files.some((file) => file.endsWith('-summary.json'))).toBe(false);

    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'measurement',
          message: expect.stringContaining('No CWV provider is scheduled'),
          source: 'configuration',
        }),
      ])
    );
    expect(summary.targets.map((target) => target.label)).toEqual([
      'home',
      'pdp',
      'blog-index',
    ]);
  });

  it('does not fail PSI-disabled offline runs for unused ambient DebugBear config', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-cwv-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-cwv.mjs'
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv(outputDir),
        DEBUGBEAR_API_KEY: 'ambient-project-key-without-project-id',
        DEBUGBEAR_PROJECT_ID: 'ambient-project-id',
        OGABASSEY_CWV_DEBUGBEAR: '',
        OGABASSEY_CWV_PSI: 'false',
      },
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.failures).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ label: 'debugbear-projects' }),
        expect.objectContaining({ label: 'debugbear-device-user-agent' }),
      ])
    );
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'measurement',
          message: expect.stringContaining('No CWV provider is scheduled'),
          source: 'configuration',
        }),
      ])
    );
  });

  it('ignores ambient DEBUGBEAR_RAW_DIR unless the PDP wrapper opts in', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-cwv-test-'));
    const ambientRawDir = await mkdtemp(join(tmpdir(), 'ogabassey-raw-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-cwv.mjs'
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv(outputDir),
        DEBUGBEAR_RAW_DIR: ambientRawDir,
        OGABASSEY_AUDIT_OUTPUT_DIR: '',
        OGABASSEY_CWV_DEBUGBEAR: '0',
        OGABASSEY_CWV_PSI: '0',
        OGABASSEY_CWV_USE_DEBUGBEAR_RAW_DIR: '0',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(ambientRawDir);
    expect(await readdir(ambientRawDir)).toEqual([]);
  });

  it('can be imported without running the CLI', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-cwv-import-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-cwv.mjs'
    );
    const importSpecifier = pathToFileURL(scriptPath).href;

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(importSpecifier)}); console.log(typeof m.runOgaBasseyCwv);`,
      ],
      { encoding: 'utf8', env: scriptEnv(outputDir) }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function');
    expect(await readdir(outputDir)).toEqual([]);
  });

  it('honors common falsey PSI disable values', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ogabassey-cwv-test-'));
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-cwv.mjs'
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...scriptEnv(outputDir),
        OGABASSEY_CWV_PSI: 'off',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('PSI mobile');
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'measurement' }),
      ])
    );
  });
});
