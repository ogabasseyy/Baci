import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';

export const workflow = YAML.parse(readFileSync('.github/workflows/jules-pr-review.yml', 'utf8'));
export const reviewStep = (name) => workflow.jobs.review.steps.find((step) => step.name === name);

export const PR_HEAD_SHA = 'a'.repeat(40);
const START_EPOCH = 1_800_000_000;

// Offline stand-ins for `curl`, `date` and `sleep`. A whole workflow step then runs in milliseconds against a
// scripted GitHub + Jules API, and the clock only moves when the step sleeps, so the test can measure exactly how
// long the step would have waited. The shell below deliberately avoids `${...}` so it stays a plain template string.
const STUBS = {
  curl: String.raw`#!/bin/sh
method=GET
data=
url=
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift ;;
    --data-binary) data="$2"; shift ;;
    --connect-timeout|--max-time|--retry|--retry-delay|-H) shift ;;
    -*) ;;
    *) url="$1" ;;
  esac
  shift
done
printf '%s %s\n' "$method" "$url" >> "$STUB_DIR/requests.log"
if [ -n "$data" ]; then
  count=$(ls "$STUB_DIR/posts" | wc -l | tr -d ' ')
  cp "$(echo "$data" | sed 's/^@//')" "$STUB_DIR/posts/$((count + 1)).json"
fi
case "$method $url" in
  "GET "*"/pulls/"*"/reviews"*) cat "$STUB_DIR/reviews.json" ;;
  "POST "*"/pulls/"*"/reviews") printf '{"id":1}' ;;
  "GET "*"/pulls/"*"/files"*) printf '[]' ;;
  "GET "*"/pulls/"*) cat "$STUB_DIR/pr.json" ;;
  "GET "*"/contents/AGENTS.md"*) printf 'Repository guidance.\n' ;;
  "GET https://jules.googleapis.com/v1alpha/sources"*) cat "$STUB_DIR/sources.json" ;;
  "POST https://jules.googleapis.com/v1alpha/sessions")
    if [ "$STUB_JULES_CREATE" = refuse ]; then
      echo 'curl: (22) The requested URL returned error: 403' >&2
      exit 22
    fi
    printf '{"id":"session-1"}' ;;
  "GET https://jules.googleapis.com/v1alpha/sessions/session-1/activities"*) cat "$STUB_DIR/activities.json" ;;
  "GET https://jules.googleapis.com/v1alpha/sessions/session-1") printf '{"state":"%s"}' "$STUB_JULES_STATE" ;;
  *) echo "curl stub: unexpected request $method $url" >&2; exit 22 ;;
esac
`,
  date: String.raw`#!/bin/sh
if [ "$1" = "+%s" ]; then read -r now < "$STUB_DIR/clock"; echo "$now"; else exec /bin/date "$@"; fi
`,
  sleep: String.raw`#!/bin/sh
read -r now < "$STUB_DIR/clock"
echo $((now + $1 * STUB_SLEEP_SCALE)) > "$STUB_DIR/clock"
read -r count < "$STUB_DIR/sleeps"
count=$((count + 1))
echo "$count" > "$STUB_DIR/sleeps"
if [ "$count" -gt 2000 ]; then
  echo 'sleep stub: the wait loop never ended' >&2
  exit 99
fi
`,
};

export function stepEnv(step, overrides = {}) {
  // Plain values written in the workflow reach the script unchanged; `${{ }}` expressions are supplied by the test.
  const literal = Object.entries(step.env ?? {}).filter(([, value]) => !String(value).includes('${{'));
  return { ...Object.fromEntries(literal.map(([key, value]) => [key, String(value)])), ...overrides };
}

export function runWorkflowStep(
  script,
  {
    env = {},
    julesState = 'IN_PROGRESS',
    julesCreate = 'accept',
    activities = [],
    reviews = [],
    headSha = PR_HEAD_SHA,
    runnerFiles = {},
    // Each `sleep` advances the fake clock this many times as long, so a long wait costs fewer loop passes.
    sleepScale = 1,
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'jules-step-'));
  try {
    const bin = join(dir, 'bin');
    const stubDir = join(dir, 'stub');
    const runnerTemp = join(dir, 'runner');
    for (const path of [bin, join(stubDir, 'posts'), runnerTemp]) mkdirSync(path, { recursive: true });
    for (const [name, body] of Object.entries(STUBS)) {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    }
    const pr = {
      base: { ref: 'main', repo: { owner: { login: 'ogabasseyy' }, name: 'Baci', default_branch: 'main' } },
      head: { ref: 'feature/test', sha: headSha, repo: { full_name: 'ogabasseyy/Baci' } },
      state: 'open',
      title: 'Test pull request',
      body: 'Test description',
    };
    const sources = {
      sources: [
        {
          name: 'sources/github/ogabasseyy/Baci',
          githubRepo: { owner: 'ogabasseyy', repo: 'Baci', branches: [{ displayName: 'feature/test' }] },
        },
      ],
    };
    const files = {
      'pr.json': JSON.stringify(pr),
      'sources.json': JSON.stringify(sources),
      'reviews.json': JSON.stringify(reviews.map((review, index) => ({ id: index + 1, ...review }))),
      'activities.json': JSON.stringify({ activities }),
      clock: String(START_EPOCH),
      sleeps: '0',
      'requests.log': '',
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(stubDir, name), body);
    for (const [name, body] of Object.entries(runnerFiles)) writeFileSync(join(runnerTemp, name), body);

    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        STUB_DIR: stubDir,
        STUB_JULES_STATE: julesState,
        STUB_JULES_CREATE: julesCreate,
        STUB_SLEEP_SCALE: String(sleepScale),
        RUNNER_TEMP: runnerTemp,
        GITHUB_API_URL: 'https://api.github.com',
        GITHUB_REPOSITORY: 'ogabasseyy/Baci',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_TOKEN: 'github-token',
        JULES_API_KEY: 'jules-key',
        PR_NUMBER: '7',
        RUN_ID: '1',
        ...env,
      },
    });
    const posts = readdirSync(join(stubDir, 'posts'))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((name) => JSON.parse(readFileSync(join(stubDir, 'posts', name), 'utf8')));
    // Read now: the sandbox is deleted as soon as this function returns.
    const written = Object.fromEntries(readdirSync(runnerTemp).map((name) => [name, readFileSync(join(runnerTemp, name), 'utf8')]));
    const runnerFile = (name) => written[name] ?? null;
    return {
      ...result,
      posts,
      runnerFile,
      requests: readFileSync(join(stubDir, 'requests.log'), 'utf8').split('\n').filter(Boolean),
      secondsWaited: Number(readFileSync(join(stubDir, 'clock'), 'utf8')) - START_EPOCH,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
