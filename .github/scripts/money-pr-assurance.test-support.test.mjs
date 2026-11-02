import assert from 'node:assert/strict';
import test from 'node:test';

import {
  at,
  claudeVerdict,
  codexClean,
  createFakeGitHub,
  HEAD,
  loadRawConfig,
  moneySnapshot,
  OLD_HEAD,
  ownerApproval,
  passingChecks,
  SUMMARY_PATH,
  validSummary,
  verdictBlock,
} from './money-pr-assurance.test-support.mjs';

test('fixture SHAs are distinct full-length hex strings', () => {
  assert.match(HEAD, /^[0-9a-f]{40}$/);
  assert.match(OLD_HEAD, /^[0-9a-f]{40}$/);
  assert.notEqual(HEAD.slice(0, 7), OLD_HEAD.slice(0, 7));
});

test('timestamps are fixed and ordered by minute', () => {
  assert.equal(at(0), '2026-10-31T12:00:00.000Z');
  assert.ok(at(1) < at(2));
});

test('builders produce the shapes the assurance modules read', () => {
  assert.match(codexClean().body, /Didn't find any major issues/);
  assert.match(codexClean().body, /`0123456789`/);
  assert.equal(codexClean().login, 'chatgpt-codex-connector[bot]');
  assert.equal(codexClean().userType, 'Bot');
  assert.match(
    verdictBlock({ verdict: 'FAIL' }),
    /^MONEY-RULES-VERDICT: FAIL$/m
  );
  assert.match(claudeVerdict().body, new RegExp(`REVIEWED-HEAD: ${HEAD}`));
  assert.equal(ownerApproval().body, 'summary-approved 0123456');
  assert.equal(ownerApproval().userType, 'User');
  assert.equal(passingChecks().length, 3);
  assert.match(validSummary(), /^Task: P5-engine-schema$/m);
  assert.match(
    validSummary({ signoff: 'not required' }),
    /^Owner sign-off: not required$/m
  );
});

test('the money snapshot merges overrides without losing defaults', () => {
  const snapshot = moneySnapshot({ pr: { body: 'x' }, comments: [] });
  assert.equal(snapshot.pr.body, 'x');
  assert.equal(snapshot.pr.headSha, HEAD);
  assert.deepEqual(snapshot.comments, []);
  assert.equal(typeof snapshot.summaries[SUMMARY_PATH], 'string');
});

test('the committed config is loaded from the repository', () => {
  assert.equal(loadRawConfig().statusContext, 'money-pr-assurance');
});

test('the fake GitHub records calls and fails unknown routes loudly', async () => {
  const fake = createFakeGitHub({
    'GET /a?b=1': { json: { ok: true }, link: '<x>; rel="next"' },
    'POST /c': ({ body }) => ({ status: 201, json: { echoed: body } }),
  });
  const first = await fake.fetch('https://api.test/a?b=1', {
    headers: { Authorization: 'Bearer t' },
  });
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(first.headers.get('Link'), '<x>; rel="next"');
  const second = await fake.fetch('https://api.test/c', {
    method: 'post',
    body: 'hello',
  });
  assert.equal(second.status, 201);
  assert.deepEqual(await second.json(), { echoed: 'hello' });
  const missing = await fake.fetch('https://api.test/nope');
  assert.equal(missing.status, 599);
  assert.equal(missing.ok, false);
  assert.deepEqual(
    fake.calls.map(({ key }) => key),
    ['GET /a?b=1', 'POST /c', 'GET /nope']
  );
  assert.equal(fake.calls[0].headers.authorization, 'Bearer t');
});
