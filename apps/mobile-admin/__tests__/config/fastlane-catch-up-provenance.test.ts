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
      builds: [{ number: 607, version: '2.1.607' }, { number: 607 }],
      runs: [mainRun(607)],
    });
    expect(output).toContain('send=2.0.607 build=607');

    const other = runCandidate({
      builds: [{ number: 607, version: '2.1.607' }],
    });
    expect(other).toContain('send=none');
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

  it('sends the latest release after the major.minor was lowered', () => {
    const output = runCandidate({
      builds: [
        { number: 600, version: '3.0.600' },
        { number: 601, version: '2.1.601' },
      ],
      live: '2.0.599',
      runs: [
        mainRun(601, { majorMinor: '2.1' }),
        mainRun(600, { majorMinor: '3.0' }),
      ],
    });
    expect(output).toContain('send=2.1.601 build=601');
  });

  it('reads older pages of release runs until it finds the main run', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      runs: [...newerManualRuns, mainRun(607)],
    });
    expect(output).toContain('send=2.0.607 build=607');
  });

  it('reads no older page once it has found a release from main', () => {
    const output = runCandidate({
      builds: [{ number: 900 }],
      runs: [mainRun(900), ...newerManualRuns],
    });
    expect(output).toContain('send=2.0.900 build=900');
    expect(output).not.toContain('runs page 2');
  });

  it('sends nothing when no release from main exists', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      runs: newerManualRuns,
    });
    expect(output).toContain('no release from main was found');
    expect(output).toContain('send=none');
  });

  it('fails visibly when the version line cannot be read', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      releaseWorkflow: 'env:\n  APP_VERSION_MAJOR_MINOR: 2.0\n',
    });
    expect(output).toContain('FAIL Could not read APP_VERSION_MAJOR_MINOR');
  });
});
