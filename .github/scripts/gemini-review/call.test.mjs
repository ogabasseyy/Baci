import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_MODEL } from './api.mjs';
import { run } from './call.mjs';

const KEY = 'AIzaTESTKEY0000000000000000000000000000';
const PROMPT = 'SECRET-PROMPT-TEXT review this diff';

function setup(files = { prompt: PROMPT }) {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-call-'));
  const env = { GEMINI_API_KEY: KEY, PROMPT_FILE: join(dir, 'prompt.md'), RESPONSE_FILE: join(dir, 'response.json'), GITHUB_OUTPUT: join(dir, 'out') };
  if (files.prompt !== undefined) writeFileSync(env.PROMPT_FILE, files.prompt);
  writeFileSync(env.GITHUB_OUTPUT, '');
  const logs = [];
  return {
    env,
    logs,
    log: (line) => logs.push(line),
    done: () => rmSync(dir, { recursive: true, force: true }),
    response: () => JSON.parse(readFileSync(env.RESPONSE_FILE, 'utf8')),
    outputs: () => readFileSync(env.GITHUB_OUTPUT, 'utf8'),
  };
}
const fetchReturning = (status, body) => async () => ({ status, text: async () => JSON.stringify(body) });
const ok = { candidates: [{ content: { parts: [{ text: '{"verdict":"ok","findings":[],"next_steps":[]}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 1, totalTokenCount: 16 }, modelVersion: 'gemini-3.6-flash' };

test('writes the answer and token usage and reports outcome ok', async () => {
  const t = setup();
  try {
    await run({ env: t.env, fetchImpl: fetchReturning(200, ok), log: t.log });
    assert.equal(t.response().ok, true);
    assert.equal(t.response().usage.promptTokens, 10);
    assert.match(t.outputs(), /^outcome=ok$/m);
  } finally {
    t.done();
  }
});

test('records the failure kind for the post step and never throws', async () => {
  const t = setup();
  try {
    const quota = { error: { code: 429, details: [{ '@type': 'x.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    await run({ env: t.env, fetchImpl: fetchReturning(429, quota), log: t.log });
    assert.equal(t.response().ok, false);
    assert.equal(t.response().kind, 'quota_daily');
    assert.match(t.outputs(), /^outcome=quota_daily$/m);
  } finally {
    t.done();
  }
});

test('uses the configured model, else the default', async () => {
  for (const [model, expected] of [['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'], ['', DEFAULT_MODEL]]) {
    const t = setup();
    try {
      let url = '';
      await run({ env: { ...t.env, GEMINI_MODEL: model }, fetchImpl: async (u) => { url = String(u); return { status: 200, text: async () => JSON.stringify(ok) }; }, log: t.log });
      assert.ok(url.includes(`/models/${expected}:`), url);
    } finally {
      t.done();
    }
  }
});

test('a missing key or a missing prompt is a recorded failure, not a crash', async () => {
  const noKey = setup();
  const noPrompt = setup({});
  try {
    let called = false;
    const fetchImpl = async () => { called = true; return { status: 200, text: async () => '{}' }; };
    await run({ env: { ...noKey.env, GEMINI_API_KEY: '' }, fetchImpl, log: noKey.log });
    assert.equal(noKey.response().kind, 'auth');
    await run({ env: noPrompt.env, fetchImpl, log: noPrompt.log });
    assert.equal(noPrompt.response().kind, 'bad_request');
    assert.equal(called, false);
  } finally {
    noKey.done();
    noPrompt.done();
  }
});

test('never logs the API key or any prompt text', async () => {
  const t = setup();
  try {
    await run({ env: t.env, fetchImpl: fetchReturning(200, ok), log: t.log });
    await run({ env: t.env, fetchImpl: fetchReturning(503, { error: { message: 'down' } }), log: t.log, sleep: async () => {} });
    const everything = [...t.logs, readFileSync(t.env.RESPONSE_FILE, 'utf8'), t.outputs()].join('\n');
    assert.ok(!everything.includes(KEY));
    assert.ok(!everything.includes('SECRET-PROMPT-TEXT'));
  } finally {
    t.done();
  }
});
