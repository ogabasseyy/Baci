import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import { post } from './post.mjs';
import { parseMarker } from './review.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const FP = 'c'.repeat(64);
const answer = (findings) => JSON.stringify({ verdict: 'Looks fine overall.', findings, next_steps: ['Add a test.'] });
const finding = (severity) => ({ severity, title: 'Unscoped query', path: 'apps/web/src/a.ts', line: 3, body: 'No merchant filter.' });
const usage = { promptTokens: 24_000, outputTokens: 400, thoughtTokens: 1600, totalTokens: 26_000 };

function setup({ response, changed = 'apps/web/src/a.ts\n', env = {}, failPaths = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-post-'));
  const files = { response: join(dir, 'response.json'), changed: join(dir, 'changed.txt'), summary: join(dir, 'summary.md') };
  if (response) writeFileSync(files.response, JSON.stringify(response));
  writeFileSync(files.changed, changed);
  writeFileSync(files.summary, '');
  const calls = [];
  const github = {
    post: async (path, body) => {
      calls.push({ path, body });
      if (failPaths.some((p) => path.startsWith(p))) throw new Error(`GitHub API 500 for POST ${path}`);
      return {};
    },
  };
  const merged = {
    HEAD_SHA: HEAD, PR_NUMBER: '7', FINGERPRINT: FP, ACTION: 'review', COLLECT_OUTCOME: 'success', SHOULD_REVIEW: 'true',
    RESPONSE_FILE: files.response, CHANGED_FILES_FILE: files.changed, GITHUB_STEP_SUMMARY: files.summary,
    RUN_URL: 'https://github.com/o/r/actions/runs/1', ...env,
  };
  const logs = [];
  return {
    calls, logs, github, env: merged,
    run: () => post({ env: merged, github, log: (line) => logs.push(line), now: () => '2026-11-11T12:00:00Z', sleep: async () => {} }),
    status: () => calls.find((c) => c.path === `statuses/${HEAD}`)?.body,
    reviews: () => calls.filter((c) => c.path === 'pulls/7/reviews'),
    summary: () => readFileSync(files.summary, 'utf8'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const okResponse = (findings) => ({ ok: true, text: answer(findings), model: 'gemini-3.6-flash', usage, attempts: 1 });
const failure = (kind) => ({ ok: false, kind, detail: 'detail text', attempts: 1 });

async function scenario(options, check) {
  const t = setup(options);
  try {
    const result = await t.run();
    await check(t, result);
  } finally {
    t.done();
  }
}

test('a clean review is posted once and sets the Gemini review status to success', () =>
  scenario({ response: okResponse([finding('low')]) }, (t, result) => {
    assert.equal(t.reviews().length, 1);
    const review = t.reviews()[0].body;
    assert.equal(review.event, 'COMMENT');
    assert.equal(review.commit_id, HEAD);
    assert.deepEqual(parseMarker(review.body), { sha: HEAD, fp: FP, state: 'success' });
    assert.match(review.body, /Model: `gemini-3\.6-flash` · 24,000 in \/ 2,000 out tokens, about \$0\.0\d+/);
    assert.deepEqual({ state: t.status().state, context: t.status().context }, { state: 'success', context: 'Gemini review' });
    assert.equal(t.status().target_url, 'https://github.com/o/r/actions/runs/1');
    assert.equal(result.exitCode, 0);
    assert.match(t.summary(), /Gemini review/);
  }));

test('a HIGH or CRITICAL finding on a changed file sets failure and fails the job', async () => {
  for (const severity of ['high', 'critical']) {
    await scenario({ response: okResponse([finding(severity)]) }, (t, result) => {
      assert.equal(t.status().state, 'failure');
      assert.equal(parseMarker(t.reviews()[0].body.body).state, 'failure');
      assert.equal(result.exitCode, 1);
      assert.ok(t.logs.some((line) => line.startsWith('::error::')));
    });
  }
});

describe('bugfix: Gemini failing to review is an abstention, never a blocking failure', () => {
  const kinds = ['quota_daily', 'quota_rate', 'unavailable', 'timeout', 'auth', 'model_not_found', 'bad_request', 'blocked', 'incomplete', 'empty', 'unknown'];
  for (const kind of kinds) {
    test(`${kind}: status error, job stays green, no review comment is posted`, () =>
      scenario({ response: failure(kind) }, (t, result) => {
        assert.equal(t.status().state, 'error');
        assert.ok(t.status().description.length <= 140);
        assert.equal(t.reviews().length, 0);
        assert.equal(result.exitCode, 0);
        assert.ok(t.logs.some((line) => line.startsWith('::warning::')));
      }));
  }

  test('an unreadable answer, a missing response and a failed collect step all report error', async () => {
    await scenario({ response: { ok: true, text: 'LGTM!', model: 'm', usage, attempts: 1 } }, (t, result) => {
      assert.equal(t.status().state, 'error');
      assert.equal(result.exitCode, 0);
    });
    await scenario({}, (t) => assert.equal(t.status().state, 'error'));
    await scenario({ response: okResponse([]), env: { COLLECT_OUTCOME: 'failure' } }, (t, result) => {
      assert.equal(t.status().state, 'error');
      assert.equal(t.reviews().length, 0);
      assert.equal(result.exitCode, 0);
    });
  });

  test('a decide step that failed to run reports error instead of guessing', () =>
    scenario({ env: { ACTION: '' } }, (t) => assert.equal(t.status().state, 'error')));
});

describe('actions decided before the model call', () => {
  test('bypass-ai-gate passes without a review', () =>
    scenario({ env: { ACTION: 'bypass' } }, (t, result) => {
      assert.equal(t.status().state, 'success');
      assert.match(t.status().description, /bypass-ai-gate/);
      assert.equal(t.reviews().length, 0);
      assert.equal(result.exitCode, 0);
    }));

  test('a private repository without a confirmed paid key reports error and sends nothing', () =>
    scenario({ env: { ACTION: 'blocked_private' } }, (t) => {
      assert.equal(t.status().state, 'error');
      assert.match(t.status().description, /private/i);
      assert.equal(t.reviews().length, 0);
    }));

  test('unchanged and duplicate carry the earlier state to the new commit without a new review', async () => {
    await scenario({ env: { ACTION: 'unchanged', CARRY_STATE: 'success', CARRY_SHA: OLD } }, (t, result) => {
      assert.equal(t.status().state, 'success');
      assert.match(t.status().description, new RegExp(OLD.slice(0, 7)));
      assert.equal(t.reviews().length, 0);
      assert.equal(result.exitCode, 0);
    });
    await scenario({ env: { ACTION: 'duplicate', CARRY_STATE: 'failure', CARRY_SHA: HEAD } }, (t, result) => {
      assert.equal(t.status().state, 'failure');
      assert.equal(t.reviews().length, 0);
      assert.equal(result.exitCode, 1);
    });
  });
});

test('bugfix: an unknown head commit (collect failed on a manual comment) only warns; the job stays green', () =>
  scenario({ env: { HEAD_SHA: '', COLLECT_OUTCOME: 'failure' } }, (t, result) => {
    assert.deepEqual(t.calls, []);
    assert.equal(result.exitCode, 0);
    assert.ok(t.logs.some((line) => line.startsWith('::warning::')));
    assert.ok(!t.logs.some((line) => line.startsWith('::error::')));
  }));

test('a pull request that is no longer open is left alone', () =>
  scenario({ response: okResponse([]), env: { SHOULD_REVIEW: 'false' } }, (t, result) => {
    assert.deepEqual(t.calls, []);
    assert.equal(result.exitCode, 0);
  }));

test('a rejected review comment does not lose the status', () =>
  scenario({ response: okResponse([finding('high')]), failPaths: ['pulls/'] }, (t, result) => {
    assert.equal(t.status().state, 'failure');
    assert.equal(result.exitCode, 1);
    assert.ok(t.logs.some((line) => line.startsWith('::warning::')));
  }));

describe('bugfix: a lost status write is an infrastructure miss, not a finding', () => {
  test('is retried once; when it still fails the job stays green for a clean or abstained review', async () => {
    for (const options of [{ response: okResponse([]) }, { response: failure('unavailable') }]) {
      const t = setup({ ...options, failPaths: ['statuses/'] });
      try {
        const result = await t.run();
        assert.equal(t.calls.filter((call) => call.path.startsWith('statuses/')).length, 2, 'one retry');
        assert.equal(result.exitCode, 0);
        assert.ok(t.logs.some((line) => line.startsWith('::warning::') && /status/i.test(line)));
      } finally {
        t.done();
      }
    }
  });

  test('a finding still fails the job even when its status cannot be written', () =>
    scenario({ response: okResponse([finding('high')]), failPaths: ['statuses/'] }, (t, result) => {
      assert.equal(result.exitCode, 1);
    }));
});

describe('bugfix: files Gemini could not check must not produce a green review', () => {
  test('an empty or unreadable changed-file list abstains instead of trusting every path', async () => {
    await scenario({ response: okResponse([finding('high')]), changed: '' }, (t, result) => {
      assert.equal(t.status().state, 'error');
      assert.equal(t.reviews().length, 0);
      assert.equal(result.exitCode, 0);
    });
    await scenario({ response: okResponse([finding('high')]), env: { CHANGED_FILES_FILE: '/nonexistent/file' } }, (t) => {
      assert.equal(t.status().state, 'error');
    });
  });

  test('file names with control characters turn a clean review into an abstention, not a success', () =>
    scenario({ response: okResponse([finding('low')]), env: { UNREVIEWABLE_FILES: '2' } }, (t, result) => {
      assert.equal(t.status().state, 'error');
      assert.match(t.status().description, /file names/i);
      assert.equal(result.exitCode, 0);
      assert.equal(t.reviews().length, 1, 'the review itself is still posted');
    }));

  test('but a real finding is still a failure', () =>
    scenario({ response: okResponse([finding('high')]), env: { UNREVIEWABLE_FILES: '1' } }, (t, result) => {
      assert.equal(t.status().state, 'failure');
      assert.equal(result.exitCode, 1);
    }));
});

test('an unverified HIGH finding on a file the pull request does not change cannot block', () =>
  scenario({ response: okResponse([{ ...finding('high'), path: 'elsewhere/x.ts' }]), changed: 'apps/web/src/a.ts\n' }, (t) => {
    assert.equal(t.status().state, 'success');
    assert.match(t.reviews()[0].body.body, /unverified/);
  }));
