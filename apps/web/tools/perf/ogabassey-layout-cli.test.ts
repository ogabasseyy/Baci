import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  HERO_HINT,
  SENTINEL,
  writeFixture,
} from './assert-ogabassey-layout-feasibility.test-support';

describe('layout feasibility CLI entry points', () => {
  it('runs the assertion entry point against a complete capture', async () => {
    const fixture = await writeFixture();
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/perf/assert-ogabassey-layout-feasibility.ts',
        '--capture-dir',
        fixture.captureDir,
        '--next-dir',
        fixture.nextDir,
        '--prebuilt-dir',
        fixture.prebuiltDir,
        '--css-sentinel',
        SENTINEL,
        '--hero-hint',
        HERO_HINT,
        '--generic-identifier',
        'cwv-layout-generic-fixture',
        '--identifier',
        'ogabassey.com',
        '--identifier',
        'ogabassey',
        '--marker',
        'data-ogabassey-critical-spike=v1',
        '--category-evidence',
        fixture.negativeRouteEvidence.category,
        '--pdp-evidence',
        fixture.negativeRouteEvidence.pdp,
        '--blog-evidence',
        fixture.negativeRouteEvidence.blog,
        '--generic-evidence',
        fixture.negativeRouteEvidence.generic,
      ],
      { encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).passed).toBe(true);
  });
  it.each([
    'assert-ogabassey-layout-feasibility',
    'run-ogabassey-layout-feasibility-fixture',
  ])('starts %s and validates its arguments', (name) => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', `tools/perf/${name}.ts`],
      { encoding: 'utf8' }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing --');
    expect(result.stderr).not.toContain('Top-level await');
  });
});
