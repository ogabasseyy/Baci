import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { decide } from './decide.mjs';
import { githubClient } from './github.mjs';
import { buildMarker } from './review.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const FP = 'c'.repeat(64);
const OTHER_FP = 'd'.repeat(64);

const review = (sha, fp, state, submitted = '2026-11-11T10:00:00Z', login = 'github-actions[bot]') => ({
  user: { login },
  submitted_at: submitted,
  body: `${buildMarker({ sha, fingerprint: fp, state })}\n## Gemini code review`,
});
const MAIN = 'f'.repeat(40);
const MERGE_FROM_MAIN = { parents: [{ sha: OLD }, { sha: MAIN }] };
const NORMAL_COMMIT = { parents: [{ sha: OLD }] };
const run = (reviews, env = {}, commit = MERGE_FROM_MAIN) =>
  decide({
    env: { HEAD_SHA: HEAD, FINGERPRINT: FP, PR_LABELS: '[]', REPO_PRIVATE: 'false', PAID_TIER_CONFIRMED: '', ...env },
    github: {
      paginate: async () => reviews,
      get: async () => {
        if (commit instanceof Error) throw commit;
        return commit;
      },
    },
  });

test('reviews a pull request that has never been reviewed', async () => {
  assert.deepEqual(await run([]), { action: 'review', carryState: '', carrySha: '' });
});

test('skips the model call and passes when the bypass-ai-gate label is present', async () => {
  const result = await run([], { PR_LABELS: JSON.stringify([{ name: 'bypass-ai-gate' }]) });
  assert.equal(result.action, 'bypass');
});

test('never sends a private repository to Gemini unless the key is confirmed as paid', async () => {
  assert.equal((await run([], { REPO_PRIVATE: 'true' })).action, 'blocked_private');
  assert.equal((await run([], { REPO_PRIVATE: 'true', PAID_TIER_CONFIRMED: 'false' })).action, 'blocked_private');
  assert.equal((await run([], { REPO_PRIVATE: 'true', PAID_TIER_CONFIRMED: 'true' })).action, 'review');
});

test('does not review the same commit twice and carries the earlier state forward', async () => {
  const result = await run([review(HEAD, FP, 'failure')]);
  assert.deepEqual(result, { action: 'duplicate', carryState: 'failure', carrySha: HEAD });
});

describe('bugfix: the same head is only a duplicate when the pull request diff is the same', () => {
  test('a pull request retargeted to another base and reopened at the same head is reviewed again', async () => {
    const result = await run([review(HEAD, OTHER_FP, 'success')]);
    assert.equal(result.action, 'review');
  });

  test('two runs that both could not read a diff (empty fingerprint) are still duplicates', async () => {
    const result = await run([review(HEAD, '', 'success')], { FINGERPRINT: '' });
    assert.equal(result.action, 'duplicate');
  });

  test('an old review without a diff fingerprint does not stand in for a run that has one', async () => {
    const result = await run([review(HEAD, '', 'success')]);
    assert.equal(result.action, 'review');
  });
});

test('a manual @gemini-cli /review comment always reviews, but still honours bypass and the private-repo guard', async () => {
  const reviews = [review(HEAD, FP, 'success')];
  assert.equal((await run(reviews, { EVENT_NAME: 'issue_comment' })).action, 'review');
  assert.equal((await run(reviews, { EVENT_NAME: 'pull_request' })).action, 'duplicate');
  assert.equal((await run(reviews, { EVENT_NAME: 'issue_comment', REPO_PRIVATE: 'true' })).action, 'blocked_private');
  assert.equal((await run(reviews, { EVENT_NAME: 'issue_comment', PR_LABELS: JSON.stringify([{ name: 'bypass-ai-gate' }]) })).action, 'bypass');
});

test('skips a merge commit whose pull request changes are identical to the last review (a merge from main)', async () => {
  const result = await run([review(OLD, FP, 'success')]);
  assert.deepEqual(result, { action: 'unchanged', carryState: 'success', carrySha: OLD });
});

describe('bugfix: matching added/removed lines are not proof that nothing changed', () => {
  test('a normal commit is always reviewed, even when its changed lines match the last review (lines moved elsewhere)', async () => {
    const result = await run([review(OLD, FP, 'success')], {}, NORMAL_COMMIT);
    assert.equal(result.action, 'review');
  });

  test('an unreadable commit is reviewed rather than trusted', async () => {
    assert.equal((await run([review(OLD, FP, 'success')], {}, new Error('GitHub API 502'))).action, 'review');
    assert.equal((await run([review(OLD, FP, 'success')], {}, {})).action, 'review');
  });
});

test('reviews again when the changes differ, comparing against the newest review only', async () => {
  assert.equal((await run([review(OLD, OTHER_FP, 'success')])).action, 'review');
  const reviews = [review(OLD, FP, 'success', '2026-11-11T09:00:00Z'), review(OLD.replace(/b/g, 'e'), OTHER_FP, 'success', '2026-11-11T10:00:00Z')];
  assert.equal((await run(reviews)).action, 'review');
});

test('ignores reviews by other authors, old-format markers and an empty fingerprint', async () => {
  assert.equal((await run([review(HEAD, FP, 'failure', undefined, 'someone')])).action, 'review');
  const oldFormat = { user: { login: 'github-actions[bot]' }, submitted_at: '2026-09-04T00:00:00Z', body: `<!-- gemini-code-review sha:${HEAD} -->\nold` };
  assert.equal((await run([oldFormat])).action, 'review');
  assert.equal((await run([review(OLD, '', 'success')], { FINGERPRINT: '' })).action, 'review');
});

test('reviews anyway when the review list cannot be read', async () => {
  const result = await decide({
    env: { HEAD_SHA: HEAD, FINGERPRINT: FP, PR_LABELS: '[]', REPO_PRIVATE: 'false' },
    github: { paginate: async () => { throw new Error('GitHub API 502'); }, get: async () => MERGE_FROM_MAIN },
  });
  assert.equal(result.action, 'review');
});

test('github client pages through results and never puts the token in an error', async () => {
  const pages = [Array.from({ length: 100 }, (_, i) => i), [100, 101]];
  const urls = [];
  const client = githubClient({
    token: 'SECRET-TOKEN',
    repo: 'o/r',
    apiUrl: 'https://api.test',
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      assert.equal(init.headers.authorization, 'Bearer SECRET-TOKEN');
      return { status: 200, json: async () => pages.shift() };
    },
  });
  assert.equal((await client.paginate('pulls/1/reviews')).length, 102);
  assert.match(urls[1], /page=2/);
  const failing = githubClient({ token: 'SECRET-TOKEN', repo: 'o/r', fetchImpl: async () => ({ status: 403, json: async () => ({}) }) });
  await assert.rejects(failing.post('statuses/x', {}), (error) => !error.message.includes('SECRET-TOKEN') && /403/.test(error.message));
});
