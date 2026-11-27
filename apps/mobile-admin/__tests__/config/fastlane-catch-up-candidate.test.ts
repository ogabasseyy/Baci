// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mainRun, runCandidate } from './catch-up-world';

describe('admin iOS catch-up: which build to send', () => {
  it('sends the newest main build that is newer than the live version', () => {
    const output = runCandidate({
      builds: [{ number: 606 }, { number: 609 }, { number: 607 }],
    });
    expect(output).toContain('send=2.0.609 build=609');
  });

  it('does nothing when nothing is newer than the live version', () => {
    const output = runCandidate({
      live: '2.0.609',
      builds: [{ number: 609 }, { number: 605 }],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('nothing newer than 2.0.609');
  });

  it('never sends an expired build or one Apple could not process', () => {
    const output = runCandidate({
      builds: [
        { number: 609, expired: true },
        { number: 608, state: 'INVALID' },
        { number: 607, state: 'FAILED' },
        { number: 606 },
      ],
    });
    // 606 is older than the latest release, so it does not stand in.
    expect(output).toContain('send=none');
    expect(output).toContain('build 609 is not usable');
  });

  it('only sends builds a push to main uploaded', () => {
    const output = runCandidate({
      builds: [610, 609, 608, 606, 611].map((number) => ({ number })),
      runs: [
        mainRun(610, {
          event: 'workflow_dispatch',
          branch: 'codex/experiment',
        }),
        mainRun(609, { branch: 'v609-admin-ios' }),
        // Manual runs stay TestFlight-only, as in a normal release.
        mainRun(608, { event: 'workflow_dispatch' }),
        mainRun(606),
        // 611 has no release run at all (a local or EAS upload).
      ],
    });
    expect(output).toContain('build=606');
  });

  // The release workflow withholds a build once a later app change is on main.
  it.each([
    'failure',
    'skipped',
  ])('sends nothing older once a later release from main ends in %s', (upload) => {
    const output = runCandidate({
      builds: [{ number: 607 }, { number: 606 }],
      runs: [mainRun(607, { upload }), mainRun(606)],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('did not upload build 607');
  });

  it('looks past newer uploads from elsewhere to the release build', () => {
    const output = runCandidate({
      builds: [{ number: 609 }, { number: 608 }, { number: 607 }],
      runs: [mainRun(607)],
    });
    expect(output).toContain('build=607');
  });

  it('waits rather than sending an older build while the newest processes', () => {
    const output = runCandidate({
      builds: [{ number: 607, state: 'PROCESSING' }, { number: 606 }],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('607 is still processing');
  });

  it.each([
    'queued',
    'in_progress',
  ])('leaves it to a release run that is still %s', (status) => {
    const output = runCandidate({
      builds: [{ number: 606 }],
      runs: [mainRun(607, { status }), mainRun(606)],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('A release run is still going');
  });

  it('is not held up by a manual branch run, which never submits', () => {
    const output = runCandidate({
      builds: [{ number: 606 }],
      runs: [
        mainRun(607, {
          event: 'workflow_dispatch',
          branch: 'codex/experiment',
          status: 'in_progress',
        }),
        mainRun(606),
      ],
    });
    expect(output).toContain('build=606');
  });

  it.each([
    'REJECTED',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
    'INVALID_BINARY',
  ])('does not resend a build left %s, nor an older one', (state) => {
    const output = runCandidate({
      builds: [{ number: 607 }, { number: 606 }],
      editable: { state, build: 607 },
    });
    expect(output).toContain('send=none');
    expect(output).toContain(state);
  });

  it('sends nothing older than a turned-down build from elsewhere', () => {
    const output = runCandidate({
      builds: [{ number: 610 }, { number: 607 }],
      runs: [mainRun(607)],
      editable: { state: 'REJECTED', build: 610 },
    });
    expect(output).toContain('send=none');
    expect(output).toContain('build 610 is REJECTED');
  });

  it('does not put an older build in place of an invalid binary', () => {
    const output = runCandidate({
      builds: [{ number: 608, state: 'INVALID' }, { number: 607 }],
      editable: { state: 'INVALID_BINARY', build: 608 },
    });
    expect(output).toContain('send=none');
  });

  it('still sends when the rejected version has no build attached', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      editable: { state: 'REJECTED' },
    });
    expect(output).toContain('build=607');
  });

  it('sends a newer build after an earlier one was rejected', () => {
    const output = runCandidate({
      builds: [{ number: 608 }, { number: 607 }],
      editable: { state: 'REJECTED', build: 607 },
    });
    expect(output).toContain('build=608');
  });

  it('retries a build whose earlier submission never finished', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      editable: { state: 'PREPARE_FOR_SUBMISSION', build: 607 },
    });
    expect(output).toContain('build=607');
  });

  it('fails visibly when there is no live version to compare with', () => {
    const output = runCandidate({ live: null, builds: [{ number: 607 }] });
    expect(output).toContain('FAIL Could not find the live iOS version');
  });
});
