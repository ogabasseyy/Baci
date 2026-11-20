import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { behindBaseFixture } from './lefthook-behind-base.test-support.mjs';

const {
  advanceRemoteMain,
  allGone,
  commit,
  git,
  gitEnv,
  gitShim,
  gitSupportsNoLazyFetch,
  hangingSsh,
  pushInput,
  runHook,
  runHookBounded,
  runHookWith,
  setup,
} = behindBaseFixture;

// Bounds on the live behind-base hook from lefthook.yml: one hard deadline for
// every remote read, one batched read for all bases, no demand-fetching, and
// a fetch hint that really refreshes the base. Helpers live in
// lefthook-behind-base.test-support.mjs.
const withPath = (dir, extra = {}) => ({
  PATH: `${dir}:${process.env.PATH}`,
  ...extra,
});

// A stuck transport must not outlive the hook. Git may start the SSH command
// through a wrapper shell that does not exec it (git's own /bin/sh on Linux),
// so signalling only git's pid orphans it. A transport that ignores SIGTERM
// dies only if the SIGKILL escalation still runs after git has exited, which
// takes the wrapper shell: otherwise git waits for its child and exits last.
const WRAPPED = { GIT_SSH_COMMAND: `sh -c 'ssh "$@"; exit $?' wrapper` };
const STUCK_TRANSPORTS = [
  ['direct', {}, {}],
  ['behind a wrapper shell', WRAPPED, {}],
  ['that ignores SIGTERM', {}, { ignoreTerm: true }],
  ['behind a wrapper shell and ignoring SIGTERM', WRAPPED, { ignoreTerm: true }],
];

for (const [shape, extraEnv, sshOptions] of STUCK_TRANSPORTS) {
  test(
    `a hard deadline ends a remote read that ignores every transport timeout (${shape})`,
    { timeout: 60_000 },
    async () => {
      const { root, work, featureSha } = setup();
      const ssh = hangingSsh(root, sshOptions);
      try {
        git(work, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/repo.git');
        const result = await runHookBounded(
          work,
          pushInput({ branch: 'feature', sha: featureSha }),
          {
            env: withPath(root, {
              BACI_BEHIND_BASE_DEADLINE_SECONDS: '3',
              ...extraEnv,
            }),
            killAfterMs: 40_000,
          }
        );

        assert.equal(
          result.timedOut,
          false,
          `hook still waiting on a stuck transport after ${result.elapsedMs}ms`
        );
        assert.equal(result.status, 0);
        assert.match(result.stdout, /skipping behind-base check/);
        assert.equal(result.stderr, '', 'killing the read must not print job noise');
        assert.ok(result.elapsedMs < 20_000, `took ${result.elapsedMs}ms`);
        assert.ok(ssh.pids().length > 0, 'the stuck transport never started');
        assert.ok(await allGone(ssh.pids()), 'the stuck transport outlived the hook');
      } finally {
        ssh.kill();
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
}

test('reads every base tip in one remote call however many branches are pushed', () => {
  const { root, remote, work, featureSha } = setup();
  try {
    // release sits at the feature commit; main moves on without it.
    git(work, 'push', '-q', 'origin', 'feature:release');
    advanceRemoteMain(root, remote);
    for (const name of ['feature-b', 'feature-c']) {
      git(work, 'branch', name, featureSha);
    }
    git(work, 'config', 'branch.feature-c.base', 'origin/release');
    const shim = gitShim(root);

    const result = runHookWith(
      work,
      featureSha,
      withPath(shim.dir),
      pushInput(
        { branch: 'feature', sha: featureSha },
        { branch: 'feature-b', sha: featureSha },
        { branch: 'feature-c', sha: featureSha }
      )
    );

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(shim.lsRemoteCalls(), 1);
    assert.match(result.stdout, /Branch 'feature' is .* behind origin\/main/);
    assert.match(result.stdout, /Branch 'feature-b' is .* behind origin\/main/);
    assert.doesNotMatch(result.stdout, /Branch 'feature-c'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'shares one deadline between the default-branch read and the base read',
  { timeout: 60_000 },
  async () => {
    const { root, work, featureSha } = setup();
    try {
      git(work, 'remote', 'set-head', 'origin', '--delete');
      // The default-branch read answers after 5s; the base read never does.
      const shim = gitShim(
        root,
        'if [ "$n" -gt 1 ]; then exec sleep 600; fi; sleep 5'
      );
      const result = await runHookBounded(
        work,
        pushInput({ branch: 'feature', sha: featureSha }),
        {
          env: withPath(shim.dir, { BACI_BEHIND_BASE_DEADLINE_SECONDS: '8' }),
          killAfterMs: 40_000,
        }
      );

      assert.equal(result.timedOut, false);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Couldn't read the base branches/);
      // Shared: 8s plus the 2s kill grace (~10s). Separate budgets: ~15s.
      assert.ok(result.elapsedMs < 12_500, `took ${result.elapsedMs}ms`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'does not demand-fetch the base tip from a promisor remote',
  { skip: gitSupportsNoLazyFetch() ? false : 'needs Git 2.45+' },
  () => {
    const { root, remote, work, featureSha } = setup({ partial: true });
    try {
      assert.equal(git(work, 'config', 'remote.origin.promisor'), 'true');
      advanceRemoteMain(root, remote);
      const tip = git(remote, 'rev-parse', 'main');

      const result = runHook(work, featureSha);

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /an unknown number of commit\(s\) behind/);
      // A lazy fetch (unbounded, outside the hook's deadline) would have
      // pulled the tip into the repository.
      const probe = spawnSync('git', ['cat-file', '-e', `${tip}^{commit}`], {
        cwd: work,
        env: { ...gitEnv, GIT_NO_LAZY_FETCH: '1' },
      });
      assert.notEqual(probe.status, 0, 'the base tip was fetched by the hook');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

// Git before 2.45 ignores GIT_NO_LAZY_FETCH, so in a partial clone a local
// lookup of a missing base tip could demand-fetch with no time limit.
test('skips loudly in a partial clone when Git cannot disable lazy fetching', () => {
  const { root, remote, work, featureSha } = setup({ partial: true });
  try {
    advanceRemoteMain(root, remote);
    const tip = git(remote, 'rev-parse', 'main');
    const shim = gitShim(root, ':', { version: '2.44.0' });

    const result = runHookWith(work, featureSha, withPath(shim.dir));

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Git older than 2\.45 cannot disable lazy fetching/);
    assert.match(result.stdout, /skipping behind-base check/i);
    assert.equal(shim.lsRemoteCalls(), 0, 'no remote read should be started');
    const probe = spawnSync('git', ['cat-file', '-e', `${tip}^{commit}`], {
      cwd: work,
      env: { ...gitEnv, GIT_NO_LAZY_FETCH: '1' },
    });
    assert.notEqual(probe.status, 0, 'the base tip was fetched by the hook');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps checking on old Git when the clone is not partial', () => {
  const { root, remote, work, featureSha } = setup();
  try {
    advanceRemoteMain(root, remote);
    const shim = gitShim(root, ':', { version: '2.44.0' });

    const result = runHookWith(work, featureSha, withPath(shim.dir));

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /behind origin\/main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the fetch hint refreshes the base ref even in a single-branch clone', () => {
  const { root, remote, work, featureSha } = setup();
  try {
    git(work, 'push', '-q', 'origin', 'feature:release');
    // Single-branch clone: the configured refspec only tracks main.
    git(work, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    git(work, 'update-ref', '-d', 'refs/remotes/origin/release');
    git(work, 'config', 'branch.feature.base', 'origin/release');
    const other = join(root, 'other');
    git(root, 'clone', '-q', remote, other);
    git(other, 'checkout', '-q', 'release');
    commit(other, 'release-work');
    git(other, 'push', '-q', 'origin', 'release');
    const releaseTip = git(remote, 'rev-parse', 'release');

    const blocked = runHook(work, featureSha);
    assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
    const hint = /git fetch .+/.exec(blocked.stdout)?.[0];
    assert.ok(hint, `no fetch command in the hint:\n${blocked.stdout}`);
    git(work, ...hint.split(' ').slice(1));

    assert.equal(git(work, 'rev-parse', 'origin/release'), releaseTip);
    // Following the hint's next step must clear the block (no fetch-merge-
    // still-blocked loop).
    git(work, 'merge', '-q', '--no-edit', 'origin/release');
    const retry = runHook(work, git(work, 'rev-parse', 'HEAD'));
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const value of ['abc', '0', '-5', '08', '']) {
  test(`keeps checking when the deadline setting is "${value}"`, () => {
    const { root, remote, work, featureSha } = setup();
    try {
      advanceRemoteMain(root, remote);
      const result = runHookWith(work, featureSha, {
        BACI_BEHIND_BASE_DEADLINE_SECONDS: value,
      });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /behind origin\/main/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
