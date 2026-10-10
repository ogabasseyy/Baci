import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { validateRecordTree } from './validate-promote-record.mjs';

const commit = 'b'.repeat(40);
const record = {
  path: '.gigl-promote-record',
  mode: '100644',
  content: `${commit}:123,456\n`,
};

test('accepts record-only trees and well-formed independent barriers', () => {
  assert.doesNotThrow(() => validateRecordTree([record]));
  assert.doesNotThrow(() =>
    validateRecordTree([
      record,
      {
        path: `barriers/${commit}-runner-123`,
        mode: '100644',
        content: `${commit}\n`,
      },
    ])
  );
});

test('accepts barrier hosts with sanitized characters', () => {
  assert.doesNotThrow(() =>
    validateRecordTree([
      record,
      {
        path: `barriers/${commit}-ops_box-123`,
        mode: '100644',
        content: `${commit}\n`,
      },
    ])
  );
});

test('accepts an empty overlap set but requires its release SHA', () => {
  assert.doesNotThrow(() =>
    validateRecordTree([{ ...record, content: `${commit}:` }])
  );
  assert.throws(
    () => validateRecordTree([{ ...record, content: ':123' }]),
    /record/
  );
});

test('never exempts application files, executable blobs or symlinks', () => {
  for (const entry of [
    { path: 'apps/web/src/app/page.tsx', mode: '100644', content: '' },
    { ...record, mode: '100755' },
    { ...record, mode: '120000' },
  ]) {
    assert.throws(() => validateRecordTree([record, entry]), /record/);
  }
});

test('rejects missing, malformed or oversized operational records', () => {
  assert.throws(() => validateRecordTree([]), /record/);
  for (const content of [
    'bad:123',
    `${commit}:123,x`,
    `${commit}:123\nsecret`,
    'x'.repeat(16385),
  ]) {
    assert.throws(() => validateRecordTree([{ ...record, content }]), /record/);
  }
});

test('the pre-push hook invokes promote-record validation', () => {
  const config = parseYaml(
    readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8')
  );
  const hook = config['pre-push'].commands['behind-base'].run;
  assert.match(hook, /validate-promote-record\.mjs/);
  assert.match(hook, /refs\/heads\/ops\/gigl-promote-record/);
  assert.match(hook, /Refusing deletion of ops\/gigl-promote-record/);
  assert.match(hook, /exit \$promote_fail/);
  assert.match(hook, /refs_file=\$\(mktemp\) \|\|/);
  assert.match(hook, /cat > "\$refs_file" \|\|/);
});

test('accepts barrier bodies with or without the trailing newline', () => {
  for (const content of [commit, `${commit}\n`]) {
    assert.doesNotThrow(() =>
      validateRecordTree([
        record,
        {
          path: `barriers/${commit}-runner-123`,
          mode: '100644',
          content,
        },
      ])
    );
  }
});

test('requires each barrier body to match its filename SHA', () => {
  for (const entry of [
    {
      path: `barriers/${commit}-runner-123`,
      mode: '100644',
      content: 'c'.repeat(40),
    },
    { path: 'barriers/not-a-release', mode: '100644', content: commit },
    { path: `barriers/${commit}-runner/123`, mode: '100644', content: commit },
    {
      path: `barriers/${commit}-runner-123`,
      mode: '100644',
      content: `  ${commit}\n`,
    },
    {
      path: `barriers/${commit}-runner-123`,
      mode: '100644',
      content: `${commit} `,
    },
    {
      path: `barriers/${commit}-runner-123`,
      mode: '100644',
      content: `${commit}\n\n`,
    },
  ]) {
    assert.throws(() => validateRecordTree([record, entry]), /record/);
  }
});

test('the CLI validates real commit trees and refuses rewritten operational history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-record-test-'));
  const script = new URL('./validate-promote-record.mjs', import.meta.url);
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: directory,
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    }).trim();
  try {
    git(['init', '--quiet']);
    const blob = git(['hash-object', '-w', '--stdin'], `${commit}:123\n`);
    const tree = git(['mktree'], `100644 blob ${blob}\t.gigl-promote-record\n`);
    const initial = git(['commit-tree', tree, '-m', 'fixture']);
    const descendant = git(['commit-tree', tree, '-p', initial, '-m', 'next']);
    const rewritten = git(['commit-tree', tree, '-m', 'rewrite']);
    const run = (next, previous) =>
      execFileSync(process.execPath, [script.pathname, next, previous], {
        cwd: directory,
        stdio: 'pipe',
      });
    assert.doesNotThrow(() => run(initial, '0'.repeat(40)));
    assert.doesNotThrow(() => run(descendant, initial));
    assert.throws(() => run(rewritten, initial));
    assert.doesNotThrow(() => run(descendant, '0'.repeat(40)));
    const unsafeTree = git(
      ['mktree'],
      `100644 blob ${blob}\t.gigl-promote-record\n100644 blob ${blob}\tpackage.json\n`
    );
    const unsafe = git([
      'commit-tree',
      unsafeTree,
      '-p',
      initial,
      '-m',
      'unsafe',
    ]);
    assert.throws(() => run(unsafe, initial));
    assert.throws(() => run(unsafe, '0'.repeat(40)));
    const hidden = git(['commit-tree', tree, '-p', unsafe, '-m', 'hide']);
    assert.throws(() => run(hidden, initial));
    const barrierBlob = git(['hash-object', '-w', '--stdin'], commit);
    const tabbedSubtree = git(
      ['mktree'],
      `100644 blob ${barrierBlob}\t${commit}-runner-1\textra\n`
    );
    const tabbedTree = git(
      ['mktree'],
      `100644 blob ${blob}\t.gigl-promote-record\n040000 tree ${tabbedSubtree}\tbarriers\n`
    );
    const tabbed = git(['commit-tree', tabbedTree, '-p', initial, '-m', 'tab']);
    assert.throws(() => run(tabbed, initial));
    const spacedSubtree = git(
      ['mktree'],
      `100644 blob ${barrierBlob}\t${commit}-runner-1 \n`
    );
    const spacedTree = git(
      ['mktree'],
      `100644 blob ${blob}\t.gigl-promote-record\n040000 tree ${spacedSubtree}\tbarriers\n`
    );
    const spaced = git([
      'commit-tree',
      spacedTree,
      '-p',
      initial,
      '-m',
      'space',
    ]);
    assert.throws(() => run(spaced, initial));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
