import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createPreviewRequest } from './preview-vercel-request.mjs';

const origin = 'https://baci-abc-basseys-projects-d7395611.vercel.app';
test('uses the pinned runner without placing credentials in arguments', async () => {
  let called = false;
  const execute = async (program, args, options) => {
    called = true;
    assert.equal(program, '/trusted/run-pinned-vercel.sh');
    assert.deepEqual(args.slice(0, 4), [
      'curl',
      '/ogabassey',
      '--deployment',
      origin,
    ]);
    assert.equal(args[4], '--');
    assert.ok(!args.join(' ').includes('secret-fixture'));
    assert.equal(options.maxBuffer, 4096);
    await writeFile(args[args.indexOf('--output') + 1], '<h1>fixture</h1>');
    await writeFile(
      args[args.indexOf('--dump-header') + 1],
      'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\n\r\n'
    );
    return { stdout: '200', stderr: '' };
  };
  const request = createPreviewRequest({
    origin,
    runner: '/trusted/run-pinned-vercel.sh',
    execute,
  });
  assert.deepEqual(await request(`${origin}/ogabassey`), {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<h1>fixture</h1>',
  });
  assert.equal(called, true);
});

test('rejects foreign destinations and does not expose command errors', async () => {
  const request = createPreviewRequest({
    origin,
    runner: '/trusted/run-pinned-vercel.sh',
    execute: async () => {
      throw new Error('secret-fixture');
    },
  });
  await assert.rejects(
    request('https://attacker.example/asset'),
    /destination/i
  );
  await assert.rejects(
    request(`${origin}/ogabassey`),
    (error) =>
      /request failed/i.test(error.message) &&
      !error.message.includes('secret-fixture')
  );
});
