// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mainRun, runCandidate } from './catch-up-world';

const releaseWorkflow = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../.github/workflows/ios-release.yml'
  ),
  'utf8'
);

// A full page of manual runs, numbers 800 down to 701, all newer than 607's.
const newerManualRuns = Array.from({ length: 100 }, (_, index) => ({
  number: 800 - index,
  event: 'workflow_dispatch',
}));

describe('admin iOS catch-up: proving a build came from main', () => {
  it('passes over a build whose version is not the one main uploaded', () => {
    // Same build number as main's 607, uploaded from elsewhere as 2.1.
    const output = runCandidate({
      builds: [{ number: 607, version: '2.1.607' }, { number: 606 }],
      runs: [mainRun(607), mainRun(606)],
    });
    expect(output).toContain('send=2.0.606 build=606');
  });

  it('takes the version from the release workflow of that run', () => {
    const output = runCandidate({
      builds: [{ number: 607, version: '2.1.607' }],
      releaseWorkflow: "env:\n  APP_VERSION_MAJOR_MINOR: '2.1'\n",
    });
    expect(output).toContain('send=2.1.607 build=607');
  });

  it('can read the version line of the real release workflow', () => {
    const majorMinor = releaseWorkflow.match(
      /APP_VERSION_MAJOR_MINOR: '(.+)'/
    )?.[1];
    expect(majorMinor).toBeDefined();
    const output = runCandidate({
      live: '1.0',
      builds: [{ number: 607, version: `${majorMinor}.607` }],
      releaseWorkflow,
    });
    expect(output).toContain(`send=${majorMinor}.607 build=607`);
  });

  it('reads older pages of release runs until it finds the main run', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      runs: [...newerManualRuns, mainRun(607)],
    });
    expect(output).toContain('send=2.0.607 build=607');
  });

  it('stops reading once the run number has been passed', () => {
    // 780 maps to run 750, on the first page and not a push to main. 20 maps
    // to no run at all.
    const output = runCandidate({
      builds: [{ number: 780 }, { number: 20, version: '2.0.700' }],
      runs: [...newerManualRuns, mainRun(607)],
    });
    expect(output).toContain('send=none');
    expect(output).not.toContain('runs page 2');
  });
});
