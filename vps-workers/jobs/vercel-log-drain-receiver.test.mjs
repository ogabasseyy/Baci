import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  createVercelLogDrainServer,
  normalizeDrainBody,
  verifyDrainSignature,
} from './vercel-log-drain-receiver.mjs';

const silentLogger = {
  error: () => undefined,
  log: () => undefined,
};

function sign(body, secret) {
  return createHmac('sha1', secret).update(body).digest('hex');
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('vercel log drain receiver', () => {
  it('normalizes JSON, JSON arrays, and NDJSON bodies', () => {
    assert.deepEqual(normalizeDrainBody(Buffer.from('{"level":"error"}')), [
      '{"level":"error"}',
    ]);
    assert.deepEqual(normalizeDrainBody(Buffer.from('[{"a":1},{"b":2}]')), [
      '{"a":1}',
      '{"b":2}',
    ]);
    assert.deepEqual(normalizeDrainBody(Buffer.from('{"a":1}\nnot-json')), [
      '{"a":1}',
    ]);
  });

  it('verifies Vercel drain HMAC signatures', () => {
    const body = Buffer.from('{"level":"error"}');
    const signature = sign(body, 'secret');

    assert.equal(
      verifyDrainSignature({ body, secret: 'secret', signature }),
      true
    );
    assert.equal(
      verifyDrainSignature({ body, secret: 'secret', signature: 'bad' }),
      false
    );
  });

  it('appends signed drain events to the configured JSONL file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-'));
    const logPath = join(directory, 'vercel-drain.jsonl');
    const secret = 'secret';
    const body = Buffer.from(
      '{"level":"error","message":"boom"}\n{"level":"info","message":"ok"}'
    );
    const server = createVercelLogDrainServer({
      logger: silentLogger,
      logPath,
      secret,
    });
    const port = await listen(server);

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/__baci/vercel-log-drain`,
        {
          body,
          headers: { 'x-vercel-signature': sign(body, secret) },
          method: 'POST',
        }
      );

      assert.equal(response.status, 204);
      assert.match(readFileSync(logPath, 'utf8'), /"message":"boom"/);
      assert.match(readFileSync(logPath, 'utf8'), /"message":"ok"/);
    } finally {
      await close(server);
    }
  });

  it('rejects unsigned drain requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-'));
    const server = createVercelLogDrainServer({
      logger: silentLogger,
      logPath: join(directory, 'vercel-drain.jsonl'),
      secret: 'secret',
    });
    const port = await listen(server);

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/__baci/vercel-log-drain`,
        { body: '{}', method: 'POST' }
      );

      assert.equal(response.status, 401);
    } finally {
      await close(server);
    }
  });

  it('rotates an oversized active drain before appending new events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-rotation-'));
    const logPath = join(directory, 'vercel-drain.jsonl');
    const rotatedPath = `${logPath}.1`;
    writeFileSync(logPath, 'x'.repeat(20));
    writeFileSync(rotatedPath, 'older');
    const secret = 'secret';
    const body = Buffer.from('{"level":"error","message":"new"}');
    const server = createVercelLogDrainServer({
      logger: silentLogger,
      logPath,
      maxLogBytes: 8,
      maxRotatedLogs: 2,
      secret,
    });
    const port = await listen(server);

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/__baci/vercel-log-drain`,
        {
          body,
          headers: { 'x-vercel-signature': sign(body, secret) },
          method: 'POST',
        }
      );

      assert.equal(response.status, 204);
      assert.match(readFileSync(logPath, 'utf8'), /"message":"new"/);
      assert.equal(readFileSync(rotatedPath, 'utf8'), 'x'.repeat(20));
      assert.equal(readFileSync(`${logPath}.2`, 'utf8'), 'older');
    } finally {
      await close(server);
    }
  });
});
