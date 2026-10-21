import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT = fileURLToPath(
  new URL('./ensure-vercel-sensitive-env.mjs', import.meta.url),
);
export const KEY = 'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET';
export const PROJECT_ID = 'prj_test';
export const TEAM_ID = 'team_test';
export const TOKEN = 'test-token';

export function makeRuntime(envContents) {
  const directory = mkdtempSync(join(tmpdir(), 'ensure-vercel-sensitive-env-'));
  const file = join(directory, '.env.production.local');
  writeFileSync(file, envContents);
  return { directory, file };
}

export function removeRuntime(runtime) {
  rmSync(runtime.directory, { recursive: true, force: true });
}

export function run(runtime, env = {}, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT, KEY, runtime.file, ...extraArgs], {
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

export function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function targetRecord(target, id = 'env_hmac') {
  return {
    id,
    key: KEY,
    type: 'sensitive',
    target: [target],
  };
}

export async function withMockApi(handler, fn) {
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

export function succeedCreate({ method, res }) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (method === 'POST') {
    res.end(JSON.stringify(targetRecord('production')));
    return;
  }

  res.end(JSON.stringify({ envs: [targetRecord('production')] }));
}

export function succeedPreviewCreate({ method, res }) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (method === 'POST') {
    res.end(JSON.stringify(targetRecord('preview')));
    return;
  }

  // The sibling Production record already exists: confirmation must
  // filter by target or the second target's first run fails closed.
  res.end(
    JSON.stringify({
      envs: [targetRecord('production', 'env_existing'), targetRecord('preview')],
    }),
  );
}
