import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import {
  createImportJobTriggerHandler,
  spawnImportJobWorker,
  startImportJobTriggerServer,
} from './import-job-trigger-server.mjs';

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

function createRequest({ headers = {}, method = 'POST', body = {} } = {}) {
  return new Request('http://127.0.0.1:3918/import-jobs/trigger', {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

function sendNodeRequest({ body, headers = {}, port }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: {
          authorization: 'Bearer secret',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
        host: '127.0.0.1',
        method: 'POST',
        path: '/import-jobs/trigger',
        port,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            statusCode: response.statusCode,
          });
        });
      }
    );
    request.on('error', reject);
    request.end(body);
  });
}

describe('import job trigger server', () => {
  it('rejects requests without the configured bearer secret', async () => {
    const calls = [];
    const handler = createImportJobTriggerHandler({
      env: { IMPORT_JOB_TRIGGER_SECRET: 'secret' },
      logger: noopLogger,
      spawnWorker: (payload) => {
        calls.push(payload);
      },
    });

    const response = await handler(
      createRequest({
        headers: { authorization: 'Bearer wrong' },
        body: { jobId: '11111111-1111-4111-8111-111111111111' },
      })
    );

    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });

  it('accepts a signed trigger and starts the import worker once', async () => {
    const calls = [];
    const handler = createImportJobTriggerHandler({
      env: { IMPORT_JOB_TRIGGER_SECRET: 'secret' },
      logger: noopLogger,
      spawnWorker: (payload) => {
        calls.push(payload);
      },
    });

    const response = await handler(
      createRequest({
        headers: { authorization: 'Bearer secret' },
        body: {
          jobId: '11111111-1111-4111-8111-111111111111',
          source: 'api',
        },
      })
    );

    assert.equal(response.status, 202);
    assert.deepEqual(calls, [
      {
        jobId: '11111111-1111-4111-8111-111111111111',
        source: 'api',
      },
    ]);
    assert.deepEqual(await response.json(), {
      accepted: true,
      status: 'started',
    });
  });

  it('rejects invalid job ids before spawning', async () => {
    const calls = [];
    const handler = createImportJobTriggerHandler({
      env: { IMPORT_JOB_TRIGGER_SECRET: 'secret' },
      logger: noopLogger,
      spawnWorker: (payload) => {
        calls.push(payload);
      },
    });

    const response = await handler(
      createRequest({
        headers: { authorization: 'Bearer secret' },
        body: { jobId: 'not-a-uuid' },
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_payload' });
    assert.equal(calls.length, 0);
  });

  it('returns 413 for oversized node request bodies', async () => {
    const server = startImportJobTriggerServer({
      env: {
        IMPORT_JOB_TRIGGER_HOST: '127.0.0.1',
        IMPORT_JOB_TRIGGER_PORT: '0',
        IMPORT_JOB_TRIGGER_SECRET: 'secret',
      },
      logger: noopLogger,
    });

    try {
      await once(server, 'listening');
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      assert.ok(port > 0 && port <= 65535);

      const response = await sendNodeRequest({
        body: 'x'.repeat(4097),
        port,
      });

      assert.equal(response.statusCode, 413);
      assert.deepEqual(JSON.parse(response.body), {
        error: 'payload_too_large',
      });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('passes the target job id to the spawned import worker environment', async () => {
    let spawnCall;

    const result = await spawnImportJobWorker({
      env: { EXISTING_ENV: 'present' },
      logger: noopLogger,
      payload: {
        jobId: '11111111-1111-4111-8111-111111111111',
        source: 'api',
      },
      spawnFn: (command, args, options) => {
        spawnCall = { args, command, options };
        return { pid: 1234, unref: () => undefined };
      },
    });

    assert.equal(result.pid, 1234);
    assert.equal(spawnCall.command, 'flock');
    assert.deepEqual(spawnCall.args.slice(0, 2), ['-w', '30']);
    assert.equal(spawnCall.options.stdio, 'ignore');
    assert.equal(
      spawnCall.options.env.IMPORT_JOB_TRIGGER_JOB_ID,
      '11111111-1111-4111-8111-111111111111'
    );
    assert.equal(spawnCall.options.env.IMPORT_JOB_TRIGGER_SOURCE, 'api');
    assert.equal(spawnCall.options.env.BACI_WORKER_PROFILE, 'import-jobs');
    assert.equal(spawnCall.options.env.NODE_ENV, 'production');
  });

  it('redirects worker output to the import worker append log', async () => {
    let spawnCall;

    await spawnImportJobWorker({
      logger: noopLogger,
      payload: {
        jobId: '11111111-1111-4111-8111-111111111111',
        source: 'api',
      },
      spawnFn: (command, args, options) => {
        spawnCall = { args, command, options };
        return { pid: 1234, unref: () => undefined };
      },
    });

    assert.equal(spawnCall.options.stdio, 'ignore');
    assert.match(
      spawnCall.args.at(-1),
      /process-import-jobs\.sh' >> '.+process-import-jobs\.log' 2>&1/
    );
  });

  it('returns 503 when the worker process cannot be spawned', async () => {
    const handler = createImportJobTriggerHandler({
      env: { IMPORT_JOB_TRIGGER_SECRET: 'secret' },
      logger: noopLogger,
      spawnWorker: () => Promise.reject(new Error('spawn failed')),
    });

    const response = await handler(
      createRequest({
        headers: { authorization: 'Bearer secret' },
        body: {
          jobId: '11111111-1111-4111-8111-111111111111',
          source: 'api',
        },
      })
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'worker_start_failed' });
  });
});
