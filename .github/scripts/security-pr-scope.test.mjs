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
import { parse } from 'yaml';
import { fileURLToPath } from 'node:url';

const workflow = readFileSync(
  new URL('../workflows/security.yml', import.meta.url),
  'utf8'
);
const helper = fileURLToPath(new URL('./semgrep-sarif-analysis-diagnostics.py', import.meta.url));

function fixture(name = 'probe.ts', directory = 'apps/web/src/lib', baseHelper) {
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
  if (baseHelper) {
    mkdirSync(join(root, '.github/scripts'), { recursive: true });
    writeFileSync(join(root, '.github/scripts/semgrep-sarif-analysis-diagnostics.py'), baseHelper);
  }
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-qb', 'feature');
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(
    join(root, directory, name),
    'export const value = 1;'
  );
  git('add', '.');
  git('commit', '-qm', 'feature');
  return {
    root,
    git,
    run: () => {
      const result = spawnSync('python3', [helper, 'pr-targets', 'main'], { cwd: root, encoding: 'utf8' });
      return { ...result, paths: result.status === 0 ? readFileSync(join(root, 'semgrep.requested-targets'), 'utf8').split('\0').filter(Boolean) : [] };
    },
  };
}

test('security PR scope scans a changed API/library file', () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.paths, ['apps/web/src/lib/probe.ts']);
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

for (const name of ['evil\nname.ts', 'évil.ts', 'space name.ts']) {
  test(`PR scope preserves ${JSON.stringify(name)}`, () => {
    const f = fixture(name);
    try {
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.paths, [`apps/web/src/lib/${name}`]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

for (const path of ['.github/scripts/semgrep-sarif-analysis-diagnostics.py', '.github/scripts/semgrep-sarif-pg-diagnostic.py', '.github/scripts/semgrep-sarif-pg-diagnostic.test.py']) {
  test(`trusted helper ${path} is included in semantic scanning`, () => {
    const f = fixture('non-source.txt');
    try {
      mkdirSync(join(f.root, '.github/scripts'), { recursive: true });
      writeFileSync(join(f.root, path), 'print("fixture")');
      f.git('add', '.');
      f.git('commit', '-qm', 'diagnostics helper');
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.paths, [path]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('an actual non-source change produces an empty manifest', () => {
  const f = fixture('non-source.txt');
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.paths, []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('unrelated Python files retain their existing excluded PR scope', () => {
  const f = fixture('probe.py');
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.paths, []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a root Next config change remains in targeted PR scope', () => {
  const f = fixture('next.config.ts', '.');
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.paths, ['next.config.ts']);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});


test('base-pinned selection adds exact new diagnostics without dropping base-selected paths', () => {
  const oldBaseHelper = 'import pathlib\npathlib.Path("semgrep.requested-targets").write_bytes(b"apps/web/src/lib/probe.ts\\0")\n';
  const f = fixture('probe.ts', 'apps/web/src/lib', oldBaseHelper);
  try {
    const diagnosticPaths = ['.github/scripts/semgrep-sarif-pg-diagnostic.py', '.github/scripts/semgrep-sarif-pg-diagnostic.test.py'];
    for (const path of [...diagnosticPaths, '.github/scripts/unrelated.py']) {
      writeFileSync(join(f.root, path), 'print("synthetic")');
    }
    f.git('add', '.');
    f.git('commit', '-qm', 'new diagnostics');
    const selector = parse(workflow).jobs.semgrep.steps.find((step) => step.id === 'semgrep_pr_targets');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', selector.run], {
      cwd: f.root, encoding: 'utf8', env: { ...process.env, PR_BASE_REF: 'main', GITHUB_WORKSPACE: f.root },
    });
    assert.equal(result.status, 0, result.stderr);
    const paths = readFileSync(join(f.root, 'semgrep.requested-targets'), 'utf8').split('\0').filter(Boolean);
    assert.deepEqual([...new Set(paths)].sort(), ['apps/web/src/lib/probe.ts', ...diagnosticPaths].sort());
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
