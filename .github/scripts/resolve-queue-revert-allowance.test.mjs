import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveQueueRevertAllowance } from './resolve-queue-revert-allowance.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baci-queue-allowance-'));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Queue Fixture']);
  git(['config', 'user.email', 'queue@example.test']);
  writeFileSync(join(root, 'feature'), 'old\n');
  git(['add', '.']);
  git(['commit', '-qm', 'original']);
  writeFileSync(join(root, 'feature'), 'fixed\n');
  git(['commit', '-qam', 'main fix']);
  const baseSha = git(['rev-parse', 'HEAD']);
  git(['switch', '-qc', 'intentional-revert']);
  writeFileSync(join(root, 'feature'), 'old\n');
  git(['commit', '-qam', 'approved revert']);
  const prSha = git(['rev-parse', 'HEAD']);
  const pr = {
    state: 'open',
    labels: [{ name: 'allow-silent-revert' }],
    base: { ref: 'main', repo: { full_name: 'example/Baci' } },
    head: { sha: prSha },
  };
  return {
    root,
    git,
    pr,
    options: {
      repository: 'example/Baci',
      baseRef: 'refs/heads/main',
      headRef: `refs/heads/gh-readonly-queue/main/pr-12-${prSha}`,
      baseSha,
      headSha: prSha,
      git,
      readPullRequest: (number) => {
        assert.equal(number, 12);
        return pr;
      },
    },
  };
}

for (const mode of [
  'approved',
  'unlabeled',
  'different-base',
  'different-repo',
  'closed',
  'unrelated-group-change',
  'api-error',
  'missing-object',
  'unrecognized-ref',
]) {
  test(`queue revert allowance: ${mode}`, () => {
    const f = fixture();
    try {
      if (mode === 'unlabeled') f.pr.labels = [];
      if (mode === 'different-base') f.pr.base.ref = 'develop';
      if (mode === 'different-repo') f.pr.base.repo.full_name = 'other/Baci';
      if (mode === 'closed') f.pr.state = 'closed';
      if (mode === 'api-error')
        f.options.readPullRequest = () => {
          throw new Error('unavailable');
        };
      if (mode === 'missing-object') f.pr.head.sha = 'f'.repeat(40);
      if (mode === 'unrecognized-ref')
        f.options.headRef = 'refs/heads/feature/pr-12';
      if (mode === 'unrelated-group-change') {
        writeFileSync(join(f.root, 'other'), 'another PR\n');
        f.git(['add', '.']);
        f.git(['commit', '-qm', 'other queued PR']);
        f.options.headSha = f.git(['rev-parse', 'HEAD']);
      }
      assert.equal(resolveQueueRevertAllowance(f.options), mode === 'approved');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}
