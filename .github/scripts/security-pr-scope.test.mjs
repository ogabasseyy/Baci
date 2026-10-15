import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/security.yml', import.meta.url),
  'utf8'
);
const start =
  workflow.indexOf('          diff_out=') >= 0
    ? workflow.indexOf('          diff_out=')
    : workflow.indexOf('          mapfile -t changed_files');
const end = workflow.indexOf('          if [ ${#changed_files[@]}', start);
const scope = workflow
  .slice(start, end)
  .replaceAll('          ', '')
  .replaceAll('${{ github.event.pull_request.base.ref }}', 'main')
  .replaceAll('${PR_BASE_REF}', 'main');
// macOS ships bash 3 without mapfile. Preserve its line-reading semantics
// in this harness; CI runs the original builtin under Linux bash.
const mapfileCompatibility = `mapfile() { local line; changed_files=(); while IFS= read -r line; do changed_files+=("$line"); done; }`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baci-security-scope-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Synthetic Test');
  git('config', 'user.email', 'test@example.test');
  writeFileSync(join(root, 'README.md'), 'base');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-qb', 'feature');
  mkdirSync(join(root, 'apps/web/src/lib'), { recursive: true });
  writeFileSync(
    join(root, 'apps/web/src/lib/probe.ts'),
    'export const value = 1;'
  );
  git('add', '.');
  git('commit', '-qm', 'feature');
  return {
    root,
    git,
    run: () =>
      spawnSync(
        'bash',
        [
          '-e',
          '-o',
          'pipefail',
          '-c',
          `${mapfileCompatibility}\n${scope}\nprintf '%s\\n' "\${changed_files[@]}"`,
        ],
        { cwd: root, encoding: 'utf8' }
      ),
  };
}

test('security PR scope scans a changed API/library file', () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'apps/web/src/lib/probe.ts');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('security PR scope fails closed when the base ref cannot be resolved', () => {
  const f = fixture();
  try {
    f.git('update-ref', '-d', 'refs/remotes/origin/main');
    const r = f.run();
    assert.notEqual(
      r.status,
      0,
      'a missing base must fail rather than produce an empty successful scope'
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('targeted fetch does not prune away its explicit base ref', () => {
  assert.doesNotMatch(workflow, /fetch --no-tags --prune origin/);
});
