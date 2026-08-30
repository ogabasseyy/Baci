import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  failureType,
  runRemediationCodexCanary,
} from './remediation-codex-canary.mjs';

describe('remediation Codex canary', () => {
  it('exits as a sanitized skip unless explicitly enabled', () => {
    const result = runRemediationCodexCanary({ env: {} });

    assert.deepEqual(result, { skipped: true, type: 'canary_skipped' });
  });

  it('fails closed when the pinned Docker image is not configured', () => {
    assert.throws(
      () =>
        runRemediationCodexCanary({
          env: {
            BACI_REMEDIATION_CANARY_ENABLED: '1',
            BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
            BACI_REPO_DIR: '/repo',
          },
        }),
      /BACI_CODEX_DOCKER_IMAGE is required/
    );
  });

  it('fails closed when the native container Codex binary is not configured', () => {
    assert.throws(
      () =>
        runRemediationCodexCanary({
          env: {
            BACI_REMEDIATION_CANARY_ENABLED: '1',
            BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
            BACI_REPO_DIR: '/repo',
          },
        }),
      /BACI_CODEX_CONTAINER_BIN is required/
    );
  });

  it('uses the remediation image in a read-only mode without git or provider mutations', () => {
    const calls = [];
    const result = runRemediationCodexCanary({
      env: {
        BACI_REMEDIATION_CANARY_ENABLED: '1',
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        BACI_REPO_DIR: '/repo',
        CODEX_HOME: '/home/worker/.codex',
        HOME: '/home/worker',
      },
      runner(command, args, options) {
        calls.push({ args, command, options });
        return {
          status: 0,
          stderr: '',
          stdout: '{"type":"turn.completed"}\n',
        };
      },
    });

    assert.equal(result.type, 'canary_completed');
    assert.deepEqual(
      calls.map(({ command }) => command),
      ['docker', 'docker']
    );
    assert.equal(calls[0].args.includes('--read-only'), true);
    assert.equal(calls[0].args.includes('--json'), true);
    assert.equal(calls[0].args.includes('--sandbox'), true);
    assert.equal(calls[0].args.includes('read-only'), true);
    assert.equal(
      calls[0].args.includes('--dangerously-bypass-approvals-and-sandbox'),
      false
    );
    assert.equal(calls[0].args.includes('--enable'), true);
    assert.equal(calls[0].args.includes('use_legacy_landlock'), true);
    assert.equal(calls[0].args.includes('workspace-write'), false);
    assert.equal(
      calls[0].args.includes('type=bind,src=/repo,dst=/repo,readonly'),
      true
    );
    assert.equal(
      calls.some(
        ({ args, command }) =>
          ['git', 'gh'].includes(command) ||
          args.some((value) =>
            ['worktree', 'commit', 'push', 'pr', 'create'].includes(value)
          )
      ),
      false
    );
    assert.deepEqual(calls[1].args, ['rm', '-f', 'baci-remediation-repo']);
  });

  it('does not pass worker secrets to the canary Docker process', () => {
    const calls = [];

    runRemediationCodexCanary({
      env: {
        BACI_REMEDIATION_CANARY_ENABLED: '1',
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        BACI_REPO_DIR: '/repo',
        CODEX_HOME: '/home/worker/.codex',
        HOME: '/home/worker',
        SUPABASE_SERVICE_ROLE_KEY: 'must-not-reach-docker',
      },
      runner(command, args, options) {
        calls.push({ args, command, options });
        return { status: 0, stderr: '', stdout: '{"type":"turn.completed"}\n' };
      },
    });

    assert.equal(calls[0].options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(calls[0].options.env.CODEX_HOME, '/home/worker/.codex');
  });

  it('redacts a runner error before returning it to the caller', () => {
    const token = 'super-secret-token-value';

    assert.throws(
      () =>
        runRemediationCodexCanary({
          env: {
            BACI_REMEDIATION_CANARY_ENABLED: '1',
            BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
            BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
            BACI_REPO_DIR: '/repo',
            CODEX_HOME: '/home/worker/.codex',
            HOME: '/home/worker',
          },
          logger: { error: () => undefined },
          runner() {
            return { error: new Error(`Authorization: Bearer ${token}`) };
          },
        }),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(token));
        assert.match(error.message, /Authorization: \[REDACTED\]/);
        return true;
      }
    );
  });

  it('keeps the primary canary failure when cleanup throws', () => {
    const logged = [];
    let calls = 0;

    assert.throws(
      () =>
        runRemediationCodexCanary({
          env: {
            BACI_REMEDIATION_CANARY_ENABLED: '1',
            BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
            BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
            BACI_REPO_DIR: '/repo',
          },
          logger: { error: (message) => logged.push(message) },
          runner() {
            calls += 1;
            if (calls === 1) {
              return {
                status: 1,
                stderr: 'primary execution failure',
                stdout: '',
              };
            }
            throw new Error('cleanup failure');
          },
        }),
      /primary execution failure/
    );

    assert.deepEqual(logged, ['{"type":"canary_cleanup_failed"}']);
  });

  it('reports a nonzero cleanup result after a successful canary', () => {
    const logged = [];
    let calls = 0;

    const result = runRemediationCodexCanary({
      env: {
        BACI_REMEDIATION_CANARY_ENABLED: '1',
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        BACI_REPO_DIR: '/repo',
      },
      logger: { error: (message) => logged.push(message) },
      runner() {
        calls += 1;
        return calls === 1
          ? { status: 0, stderr: '', stdout: '{"type":"turn.completed"}\n' }
          : { status: 1, stderr: 'cleanup failed', stdout: '' };
      },
    });

    assert.equal(result.type, 'canary_completed');
    assert.deepEqual(logged, ['{"type":"canary_cleanup_failed"}']);
  });

  it('uses the default timeout for a non-integer canary timeout', () => {
    const calls = [];

    runRemediationCodexCanary({
      env: {
        BACI_REMEDIATION_CANARY_ENABLED: '1',
        BACI_CODEX_CANARY_TIMEOUT_MS: '1.5',
        BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
        BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
        BACI_REPO_DIR: '/repo',
        CODEX_HOME: '/home/worker/.codex',
        HOME: '/home/worker',
      },
      runner(command, args, options) {
        calls.push({ args, command, options });
        return { status: 0, stderr: '', stdout: '{"type":"turn.completed"}\n' };
      },
    });

    assert.equal(calls[0].options.timeout, 60_000);
  });

  it('does not misclassify an authoring failure as authentication', {
    skip: process.platform !== 'linux',
  }, (t) => {
    const repoDir = mkdtempSync(join(tmpdir(), 'baci-canary-repo-'));
    t.after(() => rmSync(repoDir, { force: true, recursive: true }));
    const result = spawnSync(
      process.execPath,
      ['jobs/remediation-codex-canary.mjs'],
      {
        cwd: join(import.meta.dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          BACI_REMEDIATION_CANARY_ENABLED: '1',
          BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
          BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
          BACI_REPO_DIR: repoDir,
          BACI_REMEDIATION_GLOBAL_FLOCK_HELD: '1',
          BACI_REMEDIATION_NOTIFY_EMAILS: '',
          DOCKER_BIN: '/does-not-exist/authored-docker',
          ZEPTOMAIL_TOKEN: '',
        },
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /canary_toolchain_failed/);
    assert.doesNotMatch(result.stdout, /canary_auth_failed/);
  });

  it('classifies a quota-limit canary failure', () => {
    assert.equal(
      failureType(new Error('Codex execution failed: quota limit reached')),
      'canary_quota_failed'
    );
  });

  it('classifies an authentication canary failure', () => {
    assert.equal(
      failureType(new Error('Codex execution reported authentication failure')),
      'canary_auth_failed'
    );
  });
});
