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
const DEFAULT_PORT = 3918;
const MAX_BODY_BYTES = 4096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPort(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = createHash('sha256').update(left).digest();
  const rightBuffer = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

const isPayloadTooLargeError = (error) =>
  error instanceof Error && error.message === 'payload_too_large';

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
  if (!text) {
    throw new Error('invalid_payload');
  }
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid_payload');
  }
  const jobId = typeof parsed.jobId === 'string' ? parsed.jobId.trim() : '';
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error('invalid_payload');
  }
  const source = typeof parsed.source === 'string' ? parsed.source.trim() : '';
  return {
    jobId,
    source: source || 'api',
  };
}

function buildTriggerMetadataEnv({ jobId, source }) {
  return {
    IMPORT_JOB_TRIGGER_JOB_ID: jobId,
    ...(source ? { IMPORT_JOB_TRIGGER_SOURCE: source } : {}),
  };
}

export function spawnImportJobWorker({
  env = {},
  logger = console,
  payload,
  spawnFn = spawn,
} = {}) {
  const locksDir = join(WORKER_ROOT, 'locks');
  const logsDir = join(WORKER_ROOT, 'logs');
  mkdirSync(locksDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const logFile = join(logsDir, 'process-import-jobs.log');
  const workerCommand = [
    `cd ${shellQuote(WORKER_ROOT)}`,
    `${shellQuote(join(WORKER_ROOT, 'bin', 'process-import-jobs.sh'))} >> ${shellQuote(logFile)} 2>&1`,
  ].join(' && ');

  const child = spawnFn(
    'flock',
    [
      '-w',
      '30',
      join(locksDir, 'process-import-jobs.lock'),
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
        NODE_ENV: 'production',
      },
      stdio: 'ignore',
    }
  );
  const waitForSpawn =
    typeof child.once === 'function'
      ? new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        })
      : Promise.resolve();

  return waitForSpawn.then(() => {
    child.unref();
    logger.info?.({
      message: 'Import job trigger started worker process',
      jobId: payload.jobId,
      pid: child.pid,
      source: payload.source,
    });
    return { pid: child.pid };
  });
}

export function createImportJobTriggerHandler({
  env = process.env,
  logger = console,
  spawnWorker = (payload) => spawnImportJobWorker({ env, logger, payload }),
} = {}) {
  return async function handleImportJobTrigger(request) {
    const secret = env.IMPORT_JOB_TRIGGER_SECRET;
    if (!secret) {
      return jsonResponse({ error: 'trigger_secret_not_configured' }, 500);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }
    const url = new URL(request.url);
    if (url.pathname !== '/import-jobs/trigger') {
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
        message: 'Import job trigger payload rejected',
        error,
      });
      if (isPayloadTooLargeError(error)) {
        return jsonResponse({ error: 'payload_too_large' }, 413);
      }
      return jsonResponse({ error: 'invalid_payload' }, 400);
    }

    try {
      await spawnWorker(payload);
      return jsonResponse({ accepted: true, status: 'started' }, 202);
    } catch (error) {
      logger.error?.({
        message: 'Import job trigger failed to start worker process',
        error,
        jobId: payload.jobId,
        source: payload.source,
      });
      return jsonResponse({ error: 'worker_start_failed' }, 503);
    }
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

export function startImportJobTriggerServer({
  env = process.env,
  logger = console,
} = {}) {
  const handler = createImportJobTriggerHandler({ env, logger });
  const host = env.IMPORT_JOB_TRIGGER_HOST ?? DEFAULT_HOST;
  const port = readPort(env.IMPORT_JOB_TRIGGER_PORT, DEFAULT_PORT);
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
        message: 'Import job trigger request failed',
        error,
      });
      await writeNodeResponse(
        response,
        jsonResponse({ error: 'internal_error' }, 500)
      );
    }
  });

  server.listen(port, host, () =>
    logger.info?.(
      `[import-job-trigger] listening on http://${host}:${port}/import-jobs/trigger`
    )
  );

  const shutdown = (signal) => {
    logger.info?.(`[import-job-trigger] received ${signal}, shutting down`);
    server.close(() => {
      logger.info?.('[import-job-trigger] server closed');
    });
  };
  const removeShutdownHandlers = () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  };
  server.once('close', removeShutdownHandlers);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return server;
}

if (
  isEntrypoint(import.meta.url)
) {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  startImportJobTriggerServer();
}
