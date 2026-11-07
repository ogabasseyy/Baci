import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const head = 'a'.repeat(40);
const review = { code_review: { commit_sha: head, status: 'completed', has_any_findings: false, has_unresolved_findings: false } };
const comment = { user: { id: 199175422, type: 'Bot' }, performed_via_github_app: { id: 1144995 }, body: `<!-- codex-review-state:v1 ${JSON.stringify(review)} -->` };

function run(input, mode = 'classify') {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cli-'));
  try {
    const path = join(dir, 'comments.json');
    writeFileSync(path, input);
    return spawnSync(process.execPath, ['.github/scripts/codex-review-evidence-cli.mjs', mode === 'project' ? '--project' : path, mode === 'project' ? path : head], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('finds the review on a later page and rejects duplicate summaries', () => {
  assert.equal(run(JSON.stringify([[], [comment]])).stdout.trim(), 'clean');
  assert.equal(run(JSON.stringify([[comment], [comment]])).stdout.trim(), 'ambiguous');
});

test('projects only authoritative app comments for mutation checks', () => {
  const bot = { ...comment, id: 9, updated_at: 'now' };
  const spoof = { ...bot, performed_via_github_app: { id: 1 } };
  const result = run(JSON.stringify([[spoof, bot]]), 'project');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [[9, 'now', bot.body]]);
});

test('rejects malformed, unpaginated, and oversized responses', () => {
  for (const input of ['{', JSON.stringify([comment]), ' '.repeat(5_000_001)]) {
    assert.notEqual(run(input).status, 0);
  }
});
