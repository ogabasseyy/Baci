import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function criticalPathEnv(outputDir) {
  return {
    ...process.env,
    DEBUGBEAR_ADMIN_API_KEY: '',
    DEBUGBEAR_API_KEY: '',
    DEBUGBEAR_PROJECT_ID: '',
    OGABASSEY_AUDIT_OUTPUT_DIR: outputDir,
    OGABASSEY_CWV_DEBUGBEAR: '0',
    OGABASSEY_CWV_PSI: '0',
    PAGESPEED_INSIGHTS_API_KEY: '',
    PSI_API_KEY: '',
  };
}

describe('measure-ogabassey-critical-path CLI', () => {
  it('keeps the documented critical path scoped to home and PDP targets', async () => {
    const outputDir = await mkdtemp(
      join(tmpdir(), 'ogabassey-critical-path-test-')
    );
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-critical-path.mjs'
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...criticalPathEnv(outputDir),
        OGABASSEY_CWV_STRATEGIES: 'desktop',
        OGABASSEY_CWV_TARGET_LABELS: 'blog-index',
      },
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.targets.map((target) => target.label)).toEqual([
      'home',
      'pdp',
    ]);
  });

  it('keeps critical-path mobile-only and ignores PDP-LCP URL overrides', async () => {
    const outputDir = await mkdtemp(
      join(tmpdir(), 'ogabassey-critical-path-test-')
    );
    const scriptPath = join(
      process.cwd(),
      'tools/perf/measure-ogabassey-critical-path.mjs'
    );
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...criticalPathEnv(outputDir),
        OGABASSEY_CWV_USE_PDP_LCP_URL: '1',
        OGABASSEY_PDP_LCP_URL: 'https://ogabassey.com/wrong-lcp',
        OGABASSEY_PDP_URL: 'https://ogabassey.com/right-pdp',
      },
    });

    expect(result.status).toBe(1);
    const summary = JSON.parse(
      await readFile(join(outputDir, 'summary.json'), 'utf8')
    );
    expect(summary.targets).toEqual([
      { label: 'home', url: 'https://ogabassey.com/' },
      { label: 'pdp', url: 'https://ogabassey.com/right-pdp' },
    ]);
  });
});
