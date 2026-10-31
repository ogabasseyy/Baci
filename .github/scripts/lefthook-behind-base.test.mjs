import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { behindBaseFixture } from './lefthook-behind-base.test-support.mjs';

const {
  advanceRemoteMain,
  behindBaseScript,
  fakeSsh,
  git,
  gitEnv,
  runHook,
  runHookWith,
  setup,
} = behindBaseFixture;

// Runs the LIVE behind-base script from lefthook.yml against throwaway repos
// (helpers in lefthook-behind-base.test-support.mjs).
test('lets an up-to-date branch through', () => {
  const { root, work, featureSha } = setup();
  try {
    const result = runHook(work, featureSha);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks a branch behind base commits that were never fetched locally', () => {
  const { root, remote, work, featureSha } = setup();
  try {
    advanceRemoteMain(root, remote);
    const result = runHook(work, featureSha);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /behind origin\/main/);
    assert.match(result.stdout, /git fetch origin main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports the exact count once the base tip is available locally', () => {
  const { root, remote, work, featureSha } = setup();
  try {
    advanceRemoteMain(root, remote);
    git(work, 'fetch', '-q', 'origin', 'main');
    const result = runHook(work, featureSha);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /is 1 commit\(s\) behind origin\/main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips loudly instead of hanging when the remote cannot be read', () => {
  const { root, work, featureSha } = setup();
  try {
    git(work, 'remote', 'set-url', 'origin', join(root, 'missing.git'));
    const result = runHook(work, featureSha);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /skipping behind-base check/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// http.lowSpeedTime is 20s; the deadline leaves generous slack for slow
// machines and stays under the test timeout so cleanup always runs.
const STALLED_REMOTE_DEADLINE_MS = 90_000;

// Regression for the original hang: a remote that accepts the connection but
// never answers. The previous unbounded `git fetch` waited forever; the
// bounded ls-remote must give up and soft-skip within its stall budget.
test(
  'gives up on a stalled remote instead of hanging the push',
  // Fail (rather than hang the suite) if the hook regresses to an unbounded wait.
  { timeout: 120_000 },
  async () => {
  const { root, work, featureSha } = setup();
  const server = createServer(() => {
    // Accept and never respond.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    git(work, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/repo.git`);
    const startedAt = Date.now();
    // Own the deadline: on a regression, kill the hook's whole process group
    // so neither it nor a git child keeps this suite (and the CI job) alive.
    const result = await new Promise((resolve) => {
      const child = spawn('sh', ['-c', behindBaseScript()], {
        cwd: work,
        env: gitEnv,
        detached: true,
      });
      let stdout = '';
      const killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        resolve({ status: null, stdout, timedOut: true });
      }, STALLED_REMOTE_DEADLINE_MS);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.on('close', (status) => {
        clearTimeout(killTimer);
        resolve({ status, stdout, timedOut: false });
      });
      child.stdin.end(
        `refs/heads/feature ${featureSha} refs/heads/feature ${'0'.repeat(40)}\n`
      );
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(
      result.timedOut,
      false,
      `hook still waiting on a stalled remote after ${elapsedMs}ms`
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /skipping behind-base check/);
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
  }
);

test('bounds SSH remotes with connect and keepalive timeouts by default', () => {
  const { root, work, featureSha } = setup();
  try {
    const { log } = fakeSsh(root, 'ssh');
    git(work, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git');
    const result = runHookWith(work, featureSha, {
      PATH: `${root}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /skipping behind-base check/);
    const sshArgs = readFileSync(log, 'utf8');
    assert.match(sshArgs, /ConnectTimeout=15/);
    assert.match(sshArgs, /ServerAliveInterval=5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounds the default-branch lookup when origin/HEAD is unset', () => {
  const { root, work, featureSha } = setup();
  try {
    const { log } = fakeSsh(root, 'ssh');
    git(work, 'remote', 'set-head', 'origin', '--delete');
    git(work, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git');
    const result = runHookWith(work, featureSha, {
      PATH: `${root}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Could not determine default branch/);
    assert.match(readFileSync(log, 'utf8'), /ConnectTimeout=15/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("never overrides a developer's core.sshCommand", () => {
  const { root, work, featureSha } = setup();
  try {
    const custom = fakeSsh(root, 'custom-ssh');
    const defaultSsh = fakeSsh(root, 'ssh');
    git(work, 'config', 'core.sshCommand', custom.script);
    git(work, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git');
    const result = runHookWith(work, featureSha, {
      PATH: `${root}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0);
    assert.ok(existsSync(custom.log), 'core.sshCommand was not used');
    assert.equal(existsSync(defaultSsh.log), false);
    assert.doesNotMatch(readFileSync(custom.log, 'utf8'), /ConnectTimeout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("never overrides a developer's GIT_SSH wrapper", () => {
  const { root, work, featureSha } = setup();
  try {
    const wrapper = fakeSsh(root, 'ssh-wrapper');
    const defaultSsh = fakeSsh(root, 'ssh');
    git(work, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git');
    const result = runHookWith(work, featureSha, {
      GIT_SSH: wrapper.script,
      PATH: `${root}:${process.env.PATH}`,
    });

    assert.equal(result.status, 0);
    assert.ok(existsSync(wrapper.log), 'GIT_SSH wrapper was not used');
    assert.equal(existsSync(defaultSsh.log), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lets branch deletions through even when the base has moved', () => {
  const { root, remote, work } = setup();
  try {
    advanceRemoteMain(root, remote);
    // `git push origin --delete feature` sends an all-zero local SHA.
    const result = spawnSync('sh', ['-c', behindBaseScript()], {
      cwd: work,
      encoding: 'utf8',
      env: gitEnv,
      input: `(delete) ${'0'.repeat(40)} refs/heads/feature ${'1'.repeat(40)}\n`,
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /behind/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

