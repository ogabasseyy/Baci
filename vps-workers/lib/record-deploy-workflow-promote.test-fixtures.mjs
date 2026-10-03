import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared harness for the promote-record suites (extracted from
// record-deploy-workflow-promote.test.mjs to keep both suites under
// the 300-line limit).

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const libPath = join(scriptDir, 'check-deploy-workflow-inflight.sh');
export const systemBash = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
export const SHA = '0123456789abcdef0123456789abcdef01234567';
export const SHA2 = '123456789abcdef0123456789abcdef012345678';
export const BRANCH = 'ops/gigl-promote-record';

export function fixtureOrigin() {
  const bare = join(
    mkdtempSync(join(tmpdir(), 'baci-promote-origin-')),
    'origin.git'
  );
  execFileSync('git', ['init', '--quiet', '--bare', bare]);
  return bare;
}

export function workRepo(origin) {
  const work = mkdtempSync(join(tmpdir(), 'baci-promote-work-'));
  execFileSync('git', ['init', '--quiet', work]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', origin]);
  return work;
}

export function recordContent(bare) {
  return execFileSync(
    'git',
    ['--git-dir', bare, 'show', `${BRANCH}:.gigl-promote-record`],
    {
      encoding: 'utf8',
    }
  ).trim();
}

export function recordCommits(bare) {
  return execFileSync('git', ['--git-dir', bare, 'rev-list', BRANCH], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
}

// TSV rows (id, status, short-sha, event, url), the `gh api --jq @tsv`
// contract the record parser consumes.
export const tsvRows = (...ids) =>
  ids
    .map(
      (id, index) =>
        `${id}\tin_progress\tabc${index}def\tpush\thttps://example.invalid/runs/${id}`
    )
    .join('\n');

export function runRecord({
  sha = SHA,
  phase = 'post',
  scenario = 'ok',
  runIds = '',
  origin = null,
  env = {},
  path = null,
}) {
  const bare = origin ?? fixtureOrigin();
  const work = workRepo(bare);
  const binDir = join(work, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  const stubPath = join(binDir, 'gh');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
if [ "$GH_SCENARIO" = "listfail" ]; then echo 'gh: API error' >&2; exit 1; fi
# A real run carries exactly one status, so it surfaces under exactly
# one of the five status queries; answering every call would quintuple
# every id.
if [ ! -f "$GH_FIRST_CALL_MARKER" ]; then printf '%s' "$GH_RUN_IDS"; : > "$GH_FIRST_CALL_MARKER"; fi
`
  );
  chmodSync(stubPath, 0o755);
  const result = spawnSync(
    systemBash,
    [
      '-c',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion passed to bash -c.
      'set -euo pipefail; source "$RECORD_LIB"; record_deploy_workflow_promote "$RECORD_SHA" "${RECORD_PHASE:-post}"',
    ],
    {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        // file:// fixture origins never parse as github remotes; the
        // override is the deterministic repo for the run-list query.
        BACI_DEPLOY_WORKFLOW_REPO: 'example-owner/example-repo',
        ...env,
        RECORD_LIB: libPath,
        RECORD_SHA: sha,
        RECORD_PHASE: phase,
        GH_SCENARIO: scenario,
        GH_RUN_IDS: runIds,
        GH_FIRST_CALL_MARKER: join(work, 'gh-first-call'),
        PATH: path ?? `${binDir}:${process.env.PATH}`,
      },
    }
  );
  return { bare, result };
}
