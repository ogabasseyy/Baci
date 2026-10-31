import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ci = readFileSync(
  new URL('../workflows/ci.yml', import.meta.url),
  'utf8',
);
const guard = ci.split('  silent-revert-guard:\n')[1].split('\n  quality:')[0];
const detector = fileURLToPath(
  new URL('../../ci_scripts/detect-silent-reverts.mjs', import.meta.url),
);

test('silent revert protection runs against the queue base and integration head', () => {
  assert.match(
    guard,
    /if: github.event_name == 'pull_request' \|\| github.event_name == 'merge_group'/,
  );
  assert.match(
    guard,
    /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \|\| github.event.merge_group.base_sha \}\}/,
  );
  assert.match(
    guard,
    /HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.event.merge_group.head_sha \}\}/,
  );
  assert.match(
    guard,
    /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.event.merge_group.head_sha \}\}/,
  );
  assert.match(
    guard,
    /if: github.event_name == 'pull_request'\n {8}name: Fetch base branch history/,
  );
  assert.match(guard, /github.event_name == 'pull_request' && contains/);
});

test('the queue cannot pass Quality Gate with the silent revert guard skipped', () => {
  assert.match(ci, /EVENT_NAME: \$\{\{ github.event_name \}\}/);
  assert.match(
    ci,
    /if \[\[ "\$EVENT_NAME" == "merge_group" && "\$SILENT_REVERT_GUARD_RESULT" != "success" \]\]/,
  );
});

for (const undo of [false, true]) {
  test(`integration commit ${undo ? 'undoing' : 'preserving'} a recent main change`, () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-queue-revert-'));
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Queue Fixture');
      git('config', 'user.email', 'queue@example.test');
      writeFileSync(join(root, 'feature.txt'), 'old behavior\n');
      git('add', '.');
      git('commit', '-qm', 'original');
      writeFileSync(join(root, 'feature.txt'), 'fixed behavior\n');
      git('commit', '-qam', 'recent fix on main');
      const base = git('rev-parse', 'HEAD');
      git('switch', '-qc', 'gh-readonly-queue/main/pr-1');
      if (undo) writeFileSync(join(root, 'feature.txt'), 'old behavior\n');
      else writeFileSync(join(root, 'other.txt'), 'independent change\n');
      git('add', '.');
      git('commit', '-qm', 'queue integration');
      const head = git('rev-parse', 'HEAD');
      const result = spawnSync(process.execPath, [detector], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: head,
          ALLOW_SILENT_REVERT: 'false',
        },
      });
      assert.equal(result.status, undo ? 1 : 0, result.stdout + result.stderr);
      if (undo) assert.match(result.stdout, /restores previous blob/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
