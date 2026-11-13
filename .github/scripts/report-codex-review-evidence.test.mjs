import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const head = 'a'.repeat(40);
const marker = `<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: head, status: 'completed', has_any_findings: false, has_unresolved_findings: false } })} -->`;
const summary = { user: { id: 199175422, type: 'Bot' }, performed_via_github_app: { id: 1144995 }, body: marker };

function run({ comments = [summary], failComments = false, failProjection = false, changedHead = false, changedComments = false, unrelatedComment = false, pr = '7' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-evidence-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/usr/bin/env bash
set -eu
case "$*" in
  *'/pulls/'*)
    if [[ -f "$TEST_DIR/seen" && "${changedHead}" == true ]]; then printf '%s\\n' '${'b'.repeat(40)}'; else printf '%s\\n' '${head}'; fi
    touch "$TEST_DIR/seen" ;;
  *'/issues/'*)
    if [[ "${failComments}" == true ]]; then exit 1; fi
    if [[ -f "$TEST_DIR/comments-seen" && "${changedComments}" == true ]]; then printf '[[]]'; exit 0; fi
    if [[ -f "$TEST_DIR/comments-seen" && "${unrelatedComment}" == true ]]; then node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); p[0].push({user:{id:42,type:"User"},body:"hello"}); console.log(JSON.stringify(p))' "$TEST_DIR/comments"; exit 0; fi
    touch "$TEST_DIR/comments-seen"
    cat "$TEST_DIR/comments" ;;
  *'/statuses/'*) printf '%s\\n' "$*" >> "$TEST_DIR/statuses" ;;
  *) exit 1 ;;
esac
`);
    chmodSync(gh, 0o755);
    if (failProjection) {
      const node = join(dir, 'node');
      writeFileSync(node, `#!/usr/bin/env bash\n[[ "$*" != *--project* ]] || exit 1\nexec '${process.execPath}' "$@"\n`);
      chmodSync(node, 0o755);
    }
    writeFileSync(join(dir, 'comments'), JSON.stringify([comments]));
    const result = spawnSync('bash', ['.github/scripts/report-codex-review-evidence.sh', 'owner/repo', pr], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_DIR: dir, RUNNER_TEMP: dir, GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '1' },
    });
    let statuses = '';
    try { statuses = readFileSync(join(dir, 'statuses'), 'utf8'); } catch {}
    return { ...result, statuses };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('sets pending before reporting a current clean review', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.statuses, /state=pending/);
  assert.match(result.statuses, /state=success/);
  assert.ok(result.statuses.indexOf('state=pending') < result.statuses.indexOf('state=success'));
});

test('does not report clean if comment retrieval fails or the head changes', () => {
  for (const args of [{ failComments: true }, { failProjection: true }, { changedHead: true }, { changedComments: true }]) {
    const result = run(args);
    assert.match(result.statuses, /state=pending/);
    assert.doesNotMatch(result.statuses, /state=success/);
  }
});

test('reports unresolved findings as failure', () => {
  const payload = { code_review: { commit_sha: head, status: 'completed', has_any_findings: true, has_unresolved_findings: true } };
  const result = run({ comments: [{ ...summary, body: `<!-- codex-review-state:v1 ${JSON.stringify(payload)} -->` }] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.statuses, /state=failure/);
  assert.doesNotMatch(result.statuses, /state=success/);
});

test('an unrelated new comment does not strand a valid observation', () => {
  const result = run({ unrelatedComment: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.statuses, /state=success/);
});

test('keeps unknown reviews pending and rejects invalid pull request numbers', () => {
  const unknown = run({ comments: [] });
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.doesNotMatch(unknown.statuses, /state=success/);
  assert.notEqual(run({ pr: '7;echo' }).status, 0);
});
