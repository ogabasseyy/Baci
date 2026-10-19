/**
 * VPS worker: vercel-log-drain-receiver
 * Receives signed Vercel Drain POSTs and appends valid JSONL events to disk.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withDrainFileLock } from '../lib/drain-file-lock.mjs';
import {
  DEFAULT_DRAIN_MAX_BYTES,
  DEFAULT_DRAIN_MAX_ROTATED_FILES,
} from '../lib/vercel-error-events-limits.mjs';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/__baci/vercel-log-drain';
const DEFAULT_PORT = 8787;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_LOG_BYTES = DEFAULT_DRAIN_MAX_BYTES;
export const DEFAULT_MAX_ROTATED_LOGS = DEFAULT_DRAIN_MAX_ROTATED_FILES;

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stripSignaturePrefix(value) {
  return String(value || '')
    .trim()
    .replace(/^sha(?:1|256)=/i, '');
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyDrainSignature({ body, secret, signature }) {
  if (!secret || !signature) {
    return false;
  }
  const received = stripSignaturePrefix(signature);
  const expectedSha1 = createHmac('sha1', secret).update(body).digest('hex');
  const expectedSha256 = createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return (
    timingSafeStringEqual(received, expectedSha1) ||
    timingSafeStringEqual(received, expectedSha256)
  );
}

function jsonLineFor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return JSON.stringify(value);
}

export function normalizeDrainBody(body) {
  const text = body.toString('utf8').trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(jsonLineFor).filter(Boolean);
    }
    const line = jsonLineFor(parsed);
    return line ? [line] : [];
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        try {
          const parsed = JSON.parse(line);
          return Boolean(jsonLineFor(parsed));
        } catch {
          return false;
        }
      });
  }
}

function rotateDrainLog({ logPath, maxLogBytes, maxRotatedLogs }) {
  let size;
  try {
    size = statSync(logPath).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (size <= maxLogBytes) return;

  for (let index = maxRotatedLogs; index >= 1; index -= 1) {
    const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
    const destination = `${logPath}.${index}`;
    try {
      renameSync(source, destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function appendDrainLines({ lines, logPath, maxLogBytes, maxRotatedLogs }) {
  if (lines.length === 0) {
    return;
  }
  mkdirSync(dirname(logPath), { recursive: true });
  withDrainFileLock(`${logPath}.lock`, () => {
    rotateDrainLog({ logPath, maxLogBytes, maxRotatedLogs });
    appendFileSync(logPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  });
}

async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('drain payload too large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function respond(response, statusCode, body = '') {
  response.statusCode = statusCode;
  if (body) {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
  response.end(body);
}

export function createVercelLogDrainServer({
  drainPath = DEFAULT_PATH,
  logPath,
  logger = console,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  maxRotatedLogs = DEFAULT_MAX_ROTATED_LOGS,
  maxBytes = DEFAULT_MAX_BYTES,
  secret,
} = {}) {
  if (!logPath) {
    throw new Error('VERCEL_ERROR_LOG_PATH is required');
  }
  if (!secret) {
    throw new Error('VERCEL_LOG_DRAIN_SECRET is required');
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/healthz') {
      respond(response, 200, 'ok');
      return;
    }
    if (url.pathname !== drainPath) {
      respond(response, 404, 'not found');
      return;
    }
    if (request.method !== 'POST') {
      respond(response, 405, 'method not allowed');
      return;
    }

    try {
      const body = await readRequestBody(request, maxBytes);
      const signature = request.headers['x-vercel-signature'];
      if (!verifyDrainSignature({ body, secret, signature })) {
        respond(response, 401, 'invalid signature');
        return;
      }

      const lines = normalizeDrainBody(body);
      appendDrainLines({ lines, logPath, maxLogBytes, maxRotatedLogs });
      respond(response, 204);
    } catch (error) {
      if (error?.code === 'PAYLOAD_TOO_LARGE') {
        respond(response, 413, 'payload too large');
        return;
      }
      logger.error('[vercel-log-drain-receiver] request failed:', error);
      respond(response, 500, 'receiver error');
    }
  });
}

export function runVercelLogDrainReceiver({
  env = process.env,
  logger = console,
} = {}) {
  const host = env.VERCEL_LOG_DRAIN_RECEIVER_HOST || DEFAULT_HOST;
  const port = readPositiveInt(
    env.VERCEL_LOG_DRAIN_RECEIVER_PORT,
    DEFAULT_PORT
  );
  const drainPath = env.VERCEL_LOG_DRAIN_RECEIVER_PATH || DEFAULT_PATH;
  const maxBytes = readPositiveInt(
    env.VERCEL_LOG_DRAIN_MAX_BYTES,
    DEFAULT_MAX_BYTES
  );
  const maxLogBytes = readPositiveInt(
    env.VERCEL_ERROR_LOG_MAX_BYTES,
    DEFAULT_MAX_LOG_BYTES
  );
  const maxRotatedLogs = readPositiveInt(
    env.VERCEL_ERROR_LOG_MAX_ROTATED_FILES,
    DEFAULT_MAX_ROTATED_LOGS
  );
  const server = createVercelLogDrainServer({
    drainPath,
    logPath: env.VERCEL_ERROR_LOG_PATH,
    logger,
    maxLogBytes,
    maxRotatedLogs,
    maxBytes,
    secret: env.VERCEL_LOG_DRAIN_SECRET,
  });
  server.listen(port, host, () => {
    logger.log(
      `[vercel-log-drain-receiver] listening on ${host}:${port}${drainPath}`
    );
  });
  return server;
}

async function main() {
  const { config } = await import('dotenv');
  config({ path: new URL('../.env', import.meta.url) });
  runVercelLogDrainReceiver();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
