// Test harness for the Diff Guardian tally step: runs the step's real bash script with a
// fake `gh` on PATH that serves canned GitHub API responses and records every status POST.
// Bash 3.2 compatible on purpose (macOS ships 3.2; CI runners ship 5).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import YAML from 'yaml';

export const REPO = 'o/r';
export const SHA = 'a'.repeat(40);
export const OLD_SHA = 'b'.repeat(40);
export const PR = 7;

export const SCRIPT_DIR = resolve('.github/scripts/diff-guardian');
export const workflow = YAML.parse(readFileSync('.github/workflows/diff-guardian.yml', 'utf8'));
const step = workflow.jobs.guardian.steps.find((candidate) => String(candidate.name).startsWith('Tally AI reviewers'));
export const tallyStep = step;

const FAKE_GH = `#!/bin/bash
# Serves fixtures from $FAKE_GH_DIR; records POSTs to $FAKE_GH_DIR/posted.log.
method=GET; jqexpr=''; path=''; fields=''
while [ $# -gt 0 ]; do
  case "$1" in
    -X) shift; method="$1" ;;
    --jq) shift; jqexpr="$1" ;;
    -H) shift ;;
    -f) shift; fields="$fields$1|" ;;
    repos/*) path="$1" ;;
  esac
  shift
done
if [ "$method" = POST ]; then
  printf '%s\\t%s\\n' "$path" "$fields" >> "$FAKE_GH_DIR/posted.log"
  exit 0
fi
key="$(printf '%s' "\${path%%\\?*}" | sed 's#/#__#g')"
if [ -f "$FAKE_GH_DIR/$key.error" ]; then cat "$FAKE_GH_DIR/$key.error" >&2; exit 1; fi
if [ -f "$FAKE_GH_DIR/$key.json" ]; then
  if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$FAKE_GH_DIR/$key.json"; else cat "$FAKE_GH_DIR/$key.json"; fi
  exit 0
fi
echo "gh: Not Found (HTTP 404)" >&2
exit 1
`;

const key = (path) => path.replaceAll('/', '__');

/**
 * Review posted by the Muse workflow for `sha` (format taken from .github/scripts/muse-review/post.sh).
 * findings: a severity string, or { severity, unverified, body } (bodies are indented two spaces,
 * as post.sh prints them for summary-only findings).
 */
export function museReview({ sha = SHA, findings = [], fallback = false, verdict = 'Reviewed.', nextSteps = [], submitted = '2026-11-11T10:00:00Z' } = {}) {
  const bullets = findings.flatMap((entry) => {
    const { severity, unverified = false, body = '', suffix: customSuffix } = typeof entry === 'string' ? { severity: entry } : entry;
    const suffix = customSuffix ?? (unverified ? ' (path not in changed files — unverified)' : body ? '' : ' (see inline)');
    return [`- ${severity}: Something in apps/web/src/a.ts:1${suffix}`, ...(body ? [`  ${body}`] : [])];
  });
  return {
    user: { login: 'github-actions[bot]' },
    submitted_at: submitted,
    body: [
      `<!-- muse-code-review sha:${sha} base:1234567890 -->`,
      ...(fallback ? ['<!-- muse-fallback:v1 -->'] : []),
      '## Muse code review (advisory)',
      '',
      '## Verdict',
      '',
      verdict,
      '',
      '## Findings',
      '',
      ...(bullets.length ? bullets : ['- No meaningful issues found.']),
      '',
      '## Suggested next steps',
      '',
      ...nextSteps.map((step) => `- ${step}`),
    ].join('\n'),
  };
}

export const status = (context, state) => ({ context, state, updated_at: '2026-11-11T10:00:00Z' });
export const check = (name, statusValue, conclusion = null) => ({
  name,
  status: statusValue,
  conclusion,
  started_at: '2026-11-11T09:59:00Z',
  completed_at: statusValue === 'completed' ? '2026-11-11T10:00:00Z' : null,
});

/**
 * Runs the tally script once.
 * options: statuses, checks, reviews, workflows ({file: state | {error}}), labels, headRepo,
 *          action, label, pr, sha, currentSha.
 * Returns { code, stderr, stdout, posted: [{ state, context, description }] }.
 */
export function runTally(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'diff-guardian-'));
  try {
    const sha = options.sha ?? SHA;
    const put = (path, value) => writeFileSync(join(dir, `${key(path)}.json`), JSON.stringify(value));
    put(`repos/${REPO}/pulls/${PR}`, {
      head: { sha: options.currentSha ?? sha, repo: { full_name: options.headRepo ?? REPO } },
      labels: (options.labels ?? []).map((name) => ({ name })),
    });
    put(`repos/${REPO}/commits/${sha}/status`, { statuses: options.statuses ?? [] });
    // `gh api --paginate` prints one JSON document per page, back to back.
    const putPages = (path, pages) => writeFileSync(join(dir, `${key(path)}.json`), pages.map((page) => JSON.stringify(page)).join('\n'));
    putPages(
      `repos/${REPO}/commits/${sha}/check-runs`,
      options.checkPages ?? [{ check_runs: options.checks ?? [] }],
    );
    putPages(`repos/${REPO}/pulls/${PR}/reviews`, options.reviewPages ?? [options.reviews ?? []]);
    for (const [file, value] of Object.entries(options.workflows ?? {})) {
      const path = `repos/${REPO}/actions/workflows/${file}`;
      if (typeof value === 'object') {
        writeFileSync(join(dir, `${key(path)}.error`), value.error);
      } else {
        put(path, { state: value });
      }
    }
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), FAKE_GH);
    chmodSync(join(bin, 'gh'), 0o755);
    const result = spawnSync('bash', [join(SCRIPT_DIR, 'tally.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_GH_DIR: dir,
        GITHUB_RUN_ID: '1',
        GH_TOKEN: 'test',
        REPO,
        SHA: sha,
        PR: String(options.pr ?? PR),
        EVENT_ACTION: options.action ?? 'synchronize',
        EVENT_LABEL: options.label ?? '',
        VOTERS: step.env.VOTERS,
        BLOCK_QUORUM: step.env.BLOCK_QUORUM,
        SCRIPT_DIR,
      },
    });
    const log = join(dir, 'posted.log');
    const posted = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const fields = Object.fromEntries(
              line
                .split('\t')[1]
                .split('|')
                .filter(Boolean)
                .map((field) => [field.slice(0, field.indexOf('=')), field.slice(field.indexOf('=') + 1)]),
            );
            return { state: fields.state, context: fields.context, description: fields.description };
          })
      : [];
    return { code: result.status, stderr: result.stderr, stdout: result.stdout, posted };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
