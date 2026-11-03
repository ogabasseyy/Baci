/**
 * VPS worker: AI storefront trigger server
 * Accepts signed web triggers and starts the existing storefront worker under locks.
 */

import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';

const WORKER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3917;
const MAX_BODY_BYTES = 4096;

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = createHash('sha256').update(left).digest();
  const rightBuffer = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isPayloadTooLargeError(error) {
  return error instanceof Error && error.message === 'payload_too_large';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function parseTriggerPayload(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new Error('payload_too_large');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error('payload_too_large');
  }
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid_payload');
  }
  const payload = {};
  for (const key of ['jobId', 'merchantId', 'source']) {
    const value = parsed[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('invalid_payload');
      }
      payload[key] = value.trim();
    }
  }
  return payload;
}

function buildTriggerMetadataEnv(payload = {}) {
  return Object.fromEntries(
    Object.entries({
      AI_STOREFRONT_TRIGGER_JOB_ID: payload.jobId,
      AI_STOREFRONT_TRIGGER_MERCHANT_ID: payload.merchantId,
      AI_STOREFRONT_TRIGGER_SOURCE: payload.source,
    }).filter(([, value]) => typeof value === 'string' && value.length > 0)
  );
}

export function spawnAiStorefrontWorker({
  env = process.env,
  logger = console,
  payload = {},
  spawnFn = spawn,
} = {}) {
  const locksDir = join(WORKER_ROOT, 'locks');
  const logsDir = join(WORKER_ROOT, 'logs');
  mkdirSync(locksDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const logFile = join(logsDir, 'ai-storefront-jobs.log');
  const workerCommand = [
    `cd ${JSON.stringify(WORKER_ROOT)}`,
    `${JSON.stringify(join(WORKER_ROOT, 'bin', 'process-ai-storefront-jobs.sh'))} >> ${JSON.stringify(logFile)} 2>&1`,
  ].join(' && ');

  const child = spawnFn(
    'flock',
    [
      join(locksDir, 'ollama-workload.lock'),
      'flock',
      join(locksDir, 'ai-storefront-jobs.lock'),
      'bash',
      '-lc',
      workerCommand,
    ],
    {
      cwd: WORKER_ROOT,
      detached: true,
      env: {
        ...process.env,
        ...env,
        ...buildTriggerMetadataEnv(payload),
        BACI_WORKER_PROFILE: 'ai-storefront-jobs',
        NODE_ENV: 'production',
      },
      stdio: 'ignore',
    }
  );
  child.on?.('error', (error) => {
    logger.error?.({
      message: 'AI storefront worker trigger failed to start worker process',
      error,
      jobId: payload.jobId,
      merchantId: payload.merchantId,
      source: payload.source,
    });
  });
  child.unref();
  logger.info?.({
    message: 'AI storefront worker trigger started worker process',
    jobId: payload.jobId,
    merchantId: payload.merchantId,
    pid: child.pid,
    source: payload.source,
  });
  return { pid: child.pid };
}

export function createAiStorefrontTriggerHandler({
  env = process.env,
  logger = console,
  spawnWorker = (payload) => spawnAiStorefrontWorker({ env, logger, payload }),
} = {}) {
  return async function handleAiStorefrontTrigger(request) {
    const secret = env.AI_STOREFRONT_TRIGGER_SECRET;
    if (!secret) {
      return jsonResponse({ error: 'trigger_secret_not_configured' }, 500);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }
    const url = new URL(request.url);
    if (url.pathname !== '/ai-storefront/trigger') {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    const authHeader = request.headers.get('authorization');
    if (!constantTimeEqual(authHeader ?? '', `Bearer ${secret}`)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let payload;
    try {
      payload = await parseTriggerPayload(request);
    } catch (error) {
      logger.warn?.({
        message: 'AI storefront trigger payload rejected',
        error,
      });
      if (isPayloadTooLargeError(error)) {
        return jsonResponse({ error: 'payload_too_large' }, 413);
      }
      return jsonResponse({ error: 'invalid_payload' }, 400);
    }

    spawnWorker(payload);
    return jsonResponse({ accepted: true, status: 'started' }, 202);
  };
}

function readNodeRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let rejected = false;
    let size = 0;
    request.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error('payload_too_large'));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    request.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

function toWebRequest(request, body) {
  const host = request.headers.host ?? `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return new Request(`http://${host}${request.url}`, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
  });
}

async function writeNodeResponse(response, webResponse) {
  response.statusCode = webResponse.status;
  for (const [key, value] of webResponse.headers) {
    response.setHeader(key, value);
  }
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

export function startAiStorefrontTriggerServer({
  env = process.env,
  logger = console,
} = {}) {
  const handler = createAiStorefrontTriggerHandler({ env, logger });
  const host = env.AI_STOREFRONT_TRIGGER_HOST ?? DEFAULT_HOST;
  const port = readPositiveInteger(
    env.AI_STOREFRONT_TRIGGER_PORT,
    DEFAULT_PORT
  );
  const server = createServer(async (request, response) => {
    try {
      const body = await readNodeRequestBody(request);
      const webRequest = toWebRequest(request, body);
      const webResponse = await handler(webRequest);
      await writeNodeResponse(response, webResponse);
    } catch (error) {
      if (isPayloadTooLargeError(error)) {
        await writeNodeResponse(
          response,
          jsonResponse({ error: 'payload_too_large' }, 413)
        );
        return;
      }
      logger.error?.({
        message: 'AI storefront trigger request failed',
        error,
      });
      await writeNodeResponse(
        response,
        jsonResponse({ error: 'internal_error' }, 500)
      );
    }
  });

  server.listen(port, host, () => {
    logger.info?.(
      `[ai-storefront-trigger] listening on http://${host}:${port}/ai-storefront/trigger`
    );
  });
  return server;
}

if (
  isEntrypoint(import.meta.url)
) {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  startAiStorefrontTriggerServer();
}
