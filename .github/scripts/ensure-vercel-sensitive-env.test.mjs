import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KEY,
  PROJECT_ID,
  TEAM_ID,
  TOKEN,
  digest,
  makeRuntime,
  removeRuntime,
  run,
  succeedCreate,
  succeedPreviewCreate,
  targetRecord,
  withMockApi,
} from './ensure-vercel-sensitive-env-harness.mjs';

test('no-ops when the pulled Production key is already defined', async () => {
  const runtime = makeRuntime(`${KEY}=""\n`);

  try {
    const result = await run(runtime, {
      BACI_VERCEL_API_ORIGIN: 'http://127.0.0.1:1',
      VERCEL_TOKEN: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already defined/);
    assert.equal(readFileSync(runtime.file, 'utf8'), `${KEY}=""\n`);
  } finally {
    removeRuntime(runtime);
  }
});

test('creates a Production sensitive key and records the blank placeholder', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    await withMockApi(succeedCreate, async ({ origin, requests }) => {
      const result = await run(runtime, { BACI_VERCEL_API_ORIGIN: origin });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, `/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`);
      assert.equal(requests[0].authorization, `Bearer ${TOKEN}`);
      assert.doesNotMatch(requests[0].url, /upsert/);
      const parsed = JSON.parse(requests[0].body);
      assert.equal(parsed.key, KEY);
      assert.equal(parsed.type, 'sensitive');
      assert.deepEqual(parsed.target, ['production']);
      assert.match(parsed.value, /^[a-f0-9]{64}$/);
      assert.equal(digest(parsed.value).length, 64);
      assert.equal(requests[1].method, 'GET');
      assert.equal(
        readFileSync(runtime.file, 'utf8'),
        `QUIZ_PHASE="production"\n${KEY}=""\n`,
      );
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(parsed.value));
      assert.match(result.stdout, /has been created/);
    });
  } finally {
    removeRuntime(runtime);
  }
});

test('fails closed when Vercel refuses to create the missing key', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    await withMockApi(({ res }) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'create failed' } }));
    }, async ({ origin, requests }) => {
      const result = await run(runtime, { BACI_VERCEL_API_ORIGIN: origin });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Failed to create/);
      assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="production"\n');
      assert.equal(requests.length, 1);
      const secret = JSON.parse(requests[0].body).value;
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
    });
  } finally {
    removeRuntime(runtime);
  }
});

test('fails closed when Vercel reflects the generated value', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    await withMockApi(({ body, res }) => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...targetRecord('production'), value: parsed.value }));
    }, async ({ origin }) => {
      const result = await run(runtime, { BACI_VERCEL_API_ORIGIN: origin });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /reflected/);
      assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="production"\n');
    });
  } finally {
    removeRuntime(runtime);
  }
});

test('fails closed when the Vercel API origin override is not loopback', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    const result = await run(runtime, {
      BACI_VERCEL_API_ORIGIN: 'https://example.invalid',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /non-loopback/);
    assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="production"\n');
  } finally {
    removeRuntime(runtime);
  }
});

test('fails closed when the pulled key has ambiguous duplicate assignments', async () => {
  const runtime = makeRuntime(`${KEY}=""\n${KEY}=""\n`);

  try {
    const result = await run(runtime, {
      BACI_VERCEL_API_ORIGIN: 'http://127.0.0.1:1',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ambiguous/);
    assert.equal(readFileSync(runtime.file, 'utf8'), `${KEY}=""\n${KEY}=""\n`);
  } finally {
    removeRuntime(runtime);
  }
});

test('creates a Preview sensitive key when targeted at preview', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="preview"\n');

  try {
    await withMockApi(succeedPreviewCreate, async ({ origin, requests }) => {
      const result = await run(
        runtime,
        { BACI_VERCEL_API_ORIGIN: origin },
        ['--target', 'preview'],
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(requests.length, 2);
      const parsed = JSON.parse(requests[0].body);
      assert.equal(parsed.key, KEY);
      assert.equal(parsed.type, 'sensitive');
      assert.deepEqual(parsed.target, ['preview']);
      assert.match(parsed.value, /^[a-f0-9]{64}$/);
      assert.equal(
        readFileSync(runtime.file, 'utf8'),
        `QUIZ_PHASE="preview"\n${KEY}=""\n`,
      );
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(parsed.value));
      assert.match(result.stdout, /Preview/);
    });
  } finally {
    removeRuntime(runtime);
  }
});

test('rejects an unknown --target value', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="preview"\n');

  try {
    const result = await run(runtime, {}, ['--target', 'development']);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage/);
    assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="preview"\n');
  } finally {
    removeRuntime(runtime);
  }
});
