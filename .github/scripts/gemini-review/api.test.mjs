import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequest, callGemini, classifyHttpFailure, parseRetryDelayMs } from './api.mjs';

const KEY = 'AIzaTESTKEY0000000000000000000000000000';
const okBody = (text, extra = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 200, totalTokenCount: 1250 },
  modelVersion: 'gemini-3.6-flash',
  ...extra,
});
const quota = (quotaId, retryDelay) => ({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaValue: '5' }] },
      ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
    ],
  },
});

function harness(responses) {
  const calls = [];
  const sleeps = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)) };
  };
  const run = (overrides = {}) =>
    callGemini({ fetchImpl, apiKey: KEY, model: 'gemini-3.6-flash', prompt: 'review this', sleep: async (ms) => sleeps.push(ms), ...overrides });
  return { calls, sleeps, run };
}

test('builds one JSON-mode request with no tools and a bounded thinking level', () => {
  const body = buildRequest({ prompt: 'p', model: 'gemini-3.6-flash' });
  assert.equal(body.contents[0].parts[0].text, 'p');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.ok(body.generationConfig.maxOutputTokens >= 8192, 'thinking tokens count against the output budget');
  assert.equal(body.tools, undefined);
});

test('uses a thinking budget for the 2.5 family, which has no thinking levels', () => {
  const body = buildRequest({ prompt: 'p', model: 'gemini-2.5-flash-lite' });
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, undefined);
  assert.equal(typeof body.generationConfig.thinkingConfig.thinkingBudget, 'number');
});

test('sends the key in a header, never in the URL, and returns text plus token usage', async () => {
  const { calls, run } = harness([{ status: 200, body: okBody('{"ok":true}') }]);
  const result = await run();
  assert.deepEqual(
    { ok: result.ok, text: result.text, model: result.model },
    { ok: true, text: '{"ok":true}', model: 'gemini-3.6-flash' },
  );
  assert.deepEqual(result.usage, { promptTokens: 1000, outputTokens: 50, thoughtTokens: 200, totalTokens: 1250 });
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes(KEY));
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY);
  assert.match(calls[0].url, /\/models\/gemini-3\.6-flash:generateContent$/);
});

test('rejects model names that could alter the request path', async () => {
  const { calls, run } = harness([{ status: 200, body: okBody('x') }]);
  const result = await run({ model: '../../other:thing' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'bad_request');
  assert.equal(calls.length, 0);
});

test('retries a per-minute quota error after the delay Google asks for, then succeeds', async () => {
  const { calls, sleeps, run } = harness([
    { status: 429, body: quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5s') },
    { status: 200, body: okBody('{}') },
  ]);
  const result = await run();
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(sleeps[0] >= 5000 && sleeps[0] <= 10000);
});

test('gives up on a daily quota at once (retrying cannot help)', async () => {
  for (const response of [
    { status: 429, body: quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '69325s') },
    { status: 429, body: quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '69325s') },
  ]) {
    const { calls, run } = harness([response]);
    const result = await run();
    assert.deepEqual({ ok: result.ok, kind: result.kind }, { ok: false, kind: 'quota_daily' });
    assert.equal(calls.length, 1);
  }
});

test('gives up on a per-minute quota that keeps failing', async () => {
  const { calls, run } = harness([{ status: 429, body: quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5s') }]);
  const result = await run();
  assert.deepEqual({ ok: result.ok, kind: result.kind }, { ok: false, kind: 'quota_rate' });
  assert.equal(calls.length, 3);
});

test('retries a 503 with growing waits, then reports the outage', async () => {
  const outage = { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } } };
  const recovering = harness([outage, outage, { status: 200, body: okBody('{}') }]);
  assert.equal((await recovering.run()).ok, true);
  assert.deepEqual(recovering.sleeps, [5000, 15000]);
  const down = harness([outage]);
  const result = await down.run();
  assert.deepEqual({ ok: result.ok, kind: result.kind }, { ok: false, kind: 'unavailable' });
  assert.equal(down.calls.length, 3);
});

test('treats a network error and a timeout as an outage', async () => {
  const failing = harness([new Error('connect ECONNRESET')]);
  assert.equal((await failing.run()).kind, 'unavailable');
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal((await harness([timeout]).run()).kind, 'timeout');
});

test('classifies auth, bad key, missing model and bad request without retrying', async () => {
  const cases = [
    [{ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } } }, 'auth'],
    [{ status: 401, body: { error: { code: 401, message: 'unauthenticated' } } }, 'auth'],
    [{ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } } }, 'auth'],
    [{ status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'models/x is not found' } } }, 'model_not_found'],
    [{ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unknown name thinkingLevel' } } }, 'bad_request'],
  ];
  for (const [response, kind] of cases) {
    const { calls, run } = harness([response]);
    assert.equal((await run()).kind, kind);
    assert.equal(calls.length, 1);
  }
});

test('treats blocked, empty and truncated answers as failures, not as reviews', async () => {
  const blocked = await harness([{ status: 200, body: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } }]).run();
  assert.equal(blocked.kind, 'blocked');
  const thoughtOnly = okBody('', { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] }, finishReason: 'MAX_TOKENS' }] });
  assert.equal((await harness([{ status: 200, body: thoughtOnly }]).run()).kind, 'incomplete');
  const empty = okBody('', { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] });
  assert.equal((await harness([{ status: 200, body: empty }]).run()).kind, 'empty');
  const cut = okBody('{"verdict":', { candidates: [{ content: { parts: [{ text: '{"verdict":' }] }, finishReason: 'MAX_TOKENS' }] });
  assert.equal((await harness([{ status: 200, body: cut }]).run()).kind, 'incomplete');
});

test('ignores thought parts when collecting the answer text', async () => {
  const body = okBody('', {
    candidates: [{ content: { parts: [{ text: 'secret reasoning', thought: true }, { text: '{"a":1}' }] }, finishReason: 'STOP' }],
  });
  const result = await harness([{ status: 200, body }]).run();
  assert.equal(result.text, '{"a":1}');
});

test('parses retry delays', () => {
  assert.equal(parseRetryDelayMs('5s'), 5000);
  assert.equal(parseRetryDelayMs('2.330823061s'), 2331);
  assert.equal(parseRetryDelayMs('69325s'), 69325000);
  assert.equal(parseRetryDelayMs(undefined), null);
  assert.equal(parseRetryDelayMs('soon'), null);
});

test('classifyHttpFailure reads quota ids from the error details', () => {
  assert.equal(classifyHttpFailure(429, quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')).kind, 'quota_daily');
  assert.equal(classifyHttpFailure(429, quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '5s')).kind, 'quota_rate');
  assert.equal(classifyHttpFailure(500, {}).kind, 'unavailable');
});
