import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  MAX_JSONL_READ_BYTES,
  readJsonlLogEvents,
} from './vercel-error-events.mjs';
import { readDrainTail } from './vercel-error-events-tail.mjs';

describe('Vercel JSONL drain reader', () => {
  it('reads recent events from a sparse drain beyond the string limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-events-'));
    const path = join(directory, 'drain.jsonl');
    const descriptor = openSync(path, 'w');
    try {
      const event = JSON.stringify({
        level: 'error',
        message: 'Error: recent event',
        route: '/api/recent',
      });
      const eventBytes = Buffer.from(`${event}\n`);
      const size = 513 * 1024 * 1024;
      ftruncateSync(descriptor, size);
      writeSync(
        descriptor,
        Buffer.from('\n'),
        0,
        1,
        size - eventBytes.length - 1
      );
      writeSync(
        descriptor,
        eventBytes,
        0,
        eventBytes.length,
        size - eventBytes.length
      );

      assert.deepEqual(readJsonlLogEvents(path), [JSON.parse(event)]);
    } finally {
      closeSync(descriptor);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps a record when the bounded tail starts on a line boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-events-'));
    const path = join(directory, 'drain.jsonl');
    try {
      const event = JSON.stringify({
        level: 'error',
        message: 'Error: boundary event',
        route: '/api/boundary',
      });
      const eventBytes = Buffer.from(`${event}\n`);
      const size = MAX_JSONL_READ_BYTES + eventBytes.length;
      const descriptor = openSync(path, 'w');
      ftruncateSync(descriptor, size);
      writeSync(descriptor, Buffer.from('\n'), 0, 1, eventBytes.length - 1);
      writeSync(
        descriptor,
        eventBytes,
        0,
        eventBytes.length,
        eventBytes.length
      );
      writeSync(
        descriptor,
        Buffer.alloc(MAX_JSONL_READ_BYTES - eventBytes.length, 0x20),
        0,
        MAX_JSONL_READ_BYTES - eventBytes.length,
        eventBytes.length * 2
      );
      closeSync(descriptor);

      assert.deepEqual(readJsonlLogEvents(path), [JSON.parse(event)]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('includes recent records moved to a rotated drain file within the byte bound', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-events-'));
    const path = join(directory, 'drain.jsonl');
    const rotatedPath = `${path}.1`;
    try {
      const olderEvent = JSON.stringify({
        level: 'error',
        message: 'Error: rotated event',
        route: '/api/rotated',
      });
      const currentEvent = JSON.stringify({
        level: 'error',
        message: 'Error: current event',
        route: '/api/current',
      });
      writeFileSync(rotatedPath, `${olderEvent}\n`);
      writeFileSync(path, `${currentEvent}\n`);

      assert.deepEqual(readJsonlLogEvents(path), [
        JSON.parse(olderEvent),
        JSON.parse(currentEvent),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reads every retained rotated drain configured by the receiver', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-events-'));
    const path = join(directory, 'drain.jsonl');
    try {
      const events = [1, 2, 3, 4].map((number) =>
        JSON.stringify({
          level: 'error',
          message: `Error: retained event ${number}`,
          route: `/api/retained/${number}`,
        })
      );
      writeFileSync(`${path}.3`, `${events[0]}\n`);
      writeFileSync(`${path}.2`, `${events[1]}\n`);
      writeFileSync(`${path}.1`, `${events[2]}\n`);
      writeFileSync(path, `${events[3]}\n`);

      assert.deepEqual(
        readJsonlLogEvents(path, { maxRotatedFiles: 3 }),
        events.map((event) => JSON.parse(event))
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a drain that changes during both bounded read attempts', () => {
    let signatureRead = 0;
    const signatures = () => {
      signatureRead += 1;
      return [`signature-${signatureRead}`];
    };

    assert.throws(
      () =>
        readDrainTail('ignored-drain.jsonl', 2, {
          fileSignaturesImpl: signatures,
          readFileTailImpl: () => ({ bytesRead: 0, content: '' }),
        }),
      /Vercel drain changed while reading; retry later/
    );
    assert.equal(signatureRead, 4);
  });

  it('retries when the active drain disappears during a read', () => {
    let reads = 0;
    const event = JSON.stringify({
      level: 'error',
      message: 'Error: recovered after rotation',
    });

    const content = readDrainTail('ignored-drain.jsonl', 0, {
      fileSignaturesImpl: () => ['stable'],
      readFileTailImpl: () => {
        reads += 1;
        if (reads === 1) {
          const error = new Error('active drain moved');
          error.code = 'ENOENT';
          throw error;
        }
        return {
          bytesRead: Buffer.byteLength(`${event}\n`),
          content: `${event}\n`,
        };
      },
    });

    assert.equal(content, `${event}\n`);
    assert.equal(reads, 2);
  });

  it('holds the receiver lock while reading active and rotated drains', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-vercel-events-'));
    const path = join(directory, 'drain.jsonl');
    writeFileSync(path, '{}\n');
    let lockObserved = false;

    try {
      readDrainTail(path, 0, {
        fileSignaturesImpl: () => ['stable'],
        readFileTailImpl: () => {
          lockObserved = existsSync(`${path}.lock`);
          return { bytesRead: 3, content: '{}\n' };
        },
      });

      assert.equal(lockObserved, true);
      assert.equal(existsSync(`${path}.lock`), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
