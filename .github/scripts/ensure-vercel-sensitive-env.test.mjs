import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const SCRIPT = fileURLToPath(
  new URL('./ensure-vercel-sensitive-env.mjs', import.meta.url),
);
const DEPLOY_WORKFLOW = fileURLToPath(
  new URL('../workflows/deploy.yml', import.meta.url),
);
const KEY = 'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET';
const PROJECT_ID = 'prj_test';
const TEAM_ID = 'team_test';
const TOKEN = 'test-token';

function makeRuntime(envContents) {
  const directory = mkdtempSync(join(tmpdir(), 'ensure-vercel-sensitive-env-'));
  const file = join(directory, '.env.production.local');
  writeFileSync(file, envContents);
  return { directory, file };
}

function run(runtime, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT, KEY, runtime.file], {
      env: {
        ...process.env,
        VERCEL_TOKEN: TOKEN,
        VERCEL_PROJECT_ID: PROJECT_ID,
        VERCEL_ORG_ID: TEAM_ID,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ status: 1, stderr: String(error), stdout });
    });
    child.on('close', (status) => {
      resolve({ status, stderr, stdout });
    });
  });
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function productionRecord(id = 'env_hmac') {
  return {
    id,
    key: KEY,
    type: 'sensitive',
    target: ['production'],
  };
}

async function withMockApi(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        authorization: req.headers.authorization,
        body,
        method: req.method,
        url: req.url,
      });
      handler({ body, method: req.method, res });
    });
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  try {
    return await fn({
      origin: `http://127.0.0.1:${port}`,
      requests,
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function succeedCreate({ method, res }) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (method === 'POST') {
    res.end(JSON.stringify(productionRecord()));
    return;
  }

  res.end(JSON.stringify({ envs: [productionRecord()] }));
}

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
    rmSync(runtime.directory, { recursive: true, force: true });
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
    rmSync(runtime.directory, { recursive: true, force: true });
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
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('fails closed when Vercel reflects the generated value', async () => {
  const runtime = makeRuntime('QUIZ_PHASE="production"\n');

  try {
    await withMockApi(({ body, res }) => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...productionRecord(), value: parsed.value }));
    }, async ({ origin }) => {
      const result = await run(runtime, { BACI_VERCEL_API_ORIGIN: origin });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /reflected/);
      assert.equal(readFileSync(runtime.file, 'utf8'), 'QUIZ_PHASE="production"\n');
    });
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
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
    rmSync(runtime.directory, { recursive: true, force: true });
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
    rmSync(runtime.directory, { recursive: true, force: true });
  }
});

test('production prebuilt deploy provisions a missing HMAC key after pull and before the presence assert', () => {
  const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const pullStart = workflow.indexOf(
    'run: .github/scripts/run-pinned-vercel.sh pull --yes --environment=production',
  );
  const ensureStart = workflow.indexOf(
    'ensure-vercel-sensitive-env.mjs MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
    pullStart,
  );
  const readinessStart = workflow.indexOf(
    'assert-vercel-pulled-sensitive-env.mjs MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
    pullStart,
  );
  const buildStart = workflow.indexOf('      - name: Build for Vercel', pullStart);
  const ensureCommand = workflow.slice(ensureStart, readinessStart);

  assert.ok(pullStart >= 0);
  assert.ok(ensureStart > pullStart);
  assert.ok(readinessStart > ensureStart);
  assert.ok(readinessStart < buildStart);
  assert.doesNotMatch(ensureCommand, /run-pinned-vercel\.sh/);
  assert.doesNotMatch(ensureCommand, /env add/);
});

test('ensure-script edits trigger production deployment and the deployment-script CI gate', () => {
  const deploy = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  const ci = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  const guardPaths = [
    '.github/scripts/ensure-vercel-sensitive-env.mjs',
    '.github/scripts/ensure-vercel-sensitive-env.test.mjs',
  ];

  for (const path of guardPaths) {
    assert.ok(deploy.web.includes(path), `${path} must trigger the web deployment`);
    assert.ok(ci.deploy_scripts.includes(path), `${path} must trigger deployment-script tests`);
  }
});
