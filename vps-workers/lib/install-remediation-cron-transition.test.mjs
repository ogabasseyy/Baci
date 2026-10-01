import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTransition } from './install-remediation-cron-transition.test-helper.mjs';

describe('remediation cron transition', () => {
  it('holds deploy, global, and legacy locks through the crontab handoff', () => {
    const outcome = runTransition('interleaving');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.equal(outcome.locks.length, 4);
    assert.equal(outcome.barrierFiles, true);
    assert.match(outcome.crontab, /error-remediator-global\.lock/);
  });

  it('times out with a diagnostic when a legacy lock remains held', () => {
    const outcome = runTransition('lock-timeout');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.result.stderr, /timed out waiting for .*vercel/i);
    assert.equal(outcome.crontab, '');
  });

  it('blocks a new direct entrypoint while preserving its legacy worker contract', () => {
    const outcome = runTransition('launch-race');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.remoteEntry, /BARRIER_MARKER/);
    assert.equal(outcome.remoteFactory, '');
  });

  it('waits for a pre-barrier documented direct job before rewriting the crontab', () => {
    const outcome = runTransition('direct-exit');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /vercel-error-remediator/);
  });

  it('waits for a documented PATH-based Node job using an alternate binary', () => {
    const outcome = runTransition('alternate-node-exit');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
  });

  it('drains a pre-barrier Node job with a documented no-warnings flag', () => {
    const outcome = runTransition('flag-direct-exit');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
  });

  it('waits for a slow freshly spawned legacy Node process to signal readiness', () => {
    const outcome = runTransition('slow-startup');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
  });

  it('fails closed for a remediation path used as an ambiguous Node option value', () => {
    const outcome = runTransition('unsafe-option-target');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.result.stderr, /cannot safely identify/i);
    assert.equal(outcome.crontab, '');
  });

  it('aborts and restores the barrier entrypoint when a legacy direct job does not drain', () => {
    const outcome = runTransition('direct-timeout');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.result.stderr, /legacy direct remediation processes/i);
    assert.equal(outcome.crontab, '');
    assert.match(outcome.remoteEntry, /setTimeout\(\(\) => \{\}, 5000\)/);
  });

  it('does not treat a target named as a watchdog argument as a direct remediator', () => {
    const outcome = runTransition('watchdog-argument');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
  });

  it('preserves comments and watchdog lines that only mention remediation targets', () => {
    const outcome = runTransition('preserve-unrelated');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /watchdog mentions/);
    assert.doesNotMatch(
      outcome.crontab,
      /flock -n .*vercel-error-remediator\.lock bash -lc 'cd /
    );
    assert.match(
      outcome.crontab,
      /jobs\/watchdog\.mjs jobs\/vercel-error-remediator\.mjs/
    );
  });

  it('replaces exact live two-flock remediation cron entries without touching watchdog lines', () => {
    const outcome = runTransition('legacy-two-flock');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.doesNotMatch(
      outcome.crontab,
      /BACI_REMEDIATION_GLOBAL_FLOCK_HELD=1/
    );
    assert.match(outcome.crontab, /keep this watchdog note/);
    assert.match(
      outcome.crontab,
      /jobs\/watchdog\.mjs jobs\/vercel-error-remediator\.mjs/
    );
  });

  it('rolls barrier entrypoints back after a precommit crontab failure', () => {
    const outcome = runTransition('rollback');

    assert.notEqual(outcome.result.status, 0);
    assert.equal(outcome.crontab, '');
    assert.equal(outcome.remoteEntry, 'process.exitCode = 0;\n');
  });

  it('rolls back barrier files when a later staged entrypoint is missing', () => {
    const outcome = runTransition('partial-stage');

    assert.notEqual(outcome.result.status, 0);
    assert.equal(outcome.crontab, '');
    assert.equal(outcome.remoteEntry, 'process.exitCode = 0;\n');
  });

  it('does not overwrite a concurrent operator crontab change during rollback', () => {
    const outcome = runTransition('operator-change');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.crontab, /operator-change/);
    assert.equal(outcome.remoteEntry, 'process.exitCode = 0;\n');
  });

  it('does not replace an operator crontab change made during the legacy drain', () => {
    const outcome = runTransition('operator-prewrite');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.crontab, /operator-prewrite/);
    assert.equal(outcome.remoteEntry, 'process.exitCode = 0;\n');
  });

  it('permits the genuine no-crontab response', () => {
    const outcome = runTransition('no-crontab');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /vercel-error-remediator/);
  });

  it('fails closed without replacing the crontab when reading it fails', () => {
    const outcome = runTransition('read-error');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.result.stderr, /unable to read existing crontab/i);
    assert.equal(outcome.crontab, '');
  });

  it('fails closed before rewriting the crontab when proc inspection is unavailable', () => {
    const outcome = runTransition('proc-unavailable');

    assert.notEqual(outcome.result.status, 0);
    assert.match(outcome.result.stderr, /unable to inspect \/proc/i);
    assert.equal(outcome.crontab, '');
  });

  it('ignores a non-candidate proc entry during the legacy drain', () => {
    const outcome = runTransition('non-candidate-proc');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
  });

  it('escapes percent-bearing cron command values', () => {
    const outcome = runTransition('quoted-values');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /remote\\%dir/);
    assert.match(outcome.crontab, /node\\%bin/);
    assert.match(outcome.crontab, /codex\\%test/);
  });

  it('preserves percent semantics in retained cron entries', () => {
    const outcome = runTransition('retained-percent');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /date \+\\%F/);
    assert.match(outcome.crontab, /payload%value/);
    assert.doesNotMatch(outcome.crontab, /payload\\%value/);
  });

  it('holds and emits the configured global lock path during handoff', () => {
    const outcome = runTransition('custom-global-lock');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.locks.join('\n'), /locks\/custom-global\.lock/);
    assert.match(outcome.crontab, /locks\/custom-global\.lock/);
  });

  it('honors an export-prefixed dotenv global lock setting', () => {
    const outcome = runTransition('custom-global-lock-export');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.locks.join('\n'), /locks\/custom-global\.lock/);
    assert.match(outcome.crontab, /locks\/custom-global\.lock/);
  });

  it('reports a rollback failure when an empty crontab cannot be removed', () => {
    const outcome = runTransition('rollback-remove-error');

    assert.notEqual(outcome.result.status, 0);
    assert.match(
      outcome.result.stderr,
      /unable to (?:remove crontab|verify crontab removal)/i
    );
    assert.match(outcome.crontab, /baci-remediation-transition/);
    assert.equal(
      outcome.temporaryEntries.filter((entry) =>
        entry.startsWith('baci-remediation-entrypoints.')
      ).length,
      0
    );
  });

  it('removes owned schedules when the historical Node path changes', () => {
    const outcome = runTransition('legacy-node-change');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.doesNotMatch(outcome.crontab, /old-node/);
    assert.match(outcome.crontab, /baci-remediation-transition/);
  });

  it('retains schedules that invoke a non-Node audit wrapper', () => {
    const outcome = runTransition('legacy-wrapper');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /audit-wrapper/);
  });

  it('retains detached lock mentions that do not wrap the remediation command', () => {
    const outcome = runTransition('detached-lock');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(
      outcome.crontab,
      /flock -n .*vercel-error-remediator\.lock true;/
    );
  });

  it('retains relative Node paths instead of treating them as owned launchers', () => {
    const outcome = runTransition('relative-node');

    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.match(outcome.crontab, /&& \.\/node /);
  });
});
