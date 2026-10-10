const assert = require('node:assert/strict');
const test = require('node:test');
const read = require('./provider_json.cjs');
const pending = new Promise(() => undefined);
const refused = /^Error: provider_crosswalk_refused$/;

test('decodes strict JSON with nested arrays, escaped strings and independent object keys', async () => {
  const value = {
    rows: [{ id: 'one' }, { id: 'two' }],
    text: '"{}\\[]:',
    enabled: true,
    empty: null,
  };
  assert.deepEqual(
    await read(new Response(JSON.stringify(value)), 1024, pending),
    value
  );
});

test('rejects conflicting, escaped and nested duplicate keys without exposing discarded values', async () => {
  for (const raw of [
    '{"status":false,"status":true}',
    '{"status":false,"sta\\u0074us":true}',
    '{"data":{"private":"secret-marker","private":"other"}}',
    '[{"id":1,"id":2}]',
  ]) {
    await assert.rejects(read(new Response(raw), 1024, pending), refused);
  }
});

test('sanitizes malformed JSON and invalid UTF8 rather than exposing private parser errors', async () => {
  for (const body of [
    '{"private-marker":',
    '{"id":1,}',
    '[1,]',
    'true false',
    Uint8Array.from([255]),
  ]) {
    await assert.rejects(read(new Response(body), 1024, pending), refused);
  }
});

test('accepts exact byte boundary and refuses declared or streamed oversized responses', async () => {
  assert.deepEqual(
    await read(
      new Response('{}', { headers: { 'content-length': '2' } }),
      2,
      pending
    ),
    {}
  );
  for (const response of [
    new Response('123'),
    new Response('{}', { headers: { 'content-length': '3' } }),
    new Response('{}', { headers: { 'content-length': 'invalid' } }),
  ]) {
    await assert.rejects(read(response, 2, pending), refused);
  }
});

test('cancels unfinished oversized body reads and sanitizes a rejected deadline', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('oversized'));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(read(new Response(body), 2, pending), refused);
  assert.equal(cancelled, true);
  const timeout = Promise.reject(new Error('secret-deadline-marker'));
  await assert.rejects(
    read(new Response(new ReadableStream()), 1024, timeout),
    refused
  );
});

test('rejects excessive nesting and absent response bodies', async () => {
  await assert.rejects(
    read(new Response(`${'['.repeat(34)}0${']'.repeat(34)}`), 1024, pending),
    refused
  );
  await assert.rejects(read(new Response(null), 1024, pending), refused);
});
