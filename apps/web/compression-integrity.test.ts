/** @vitest-environment node */

import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadCjs } from './security-integrity-load';
import { resolveRoot } from './security-integrity-resolve';

// Behavioral coverage for CVE-2026-87776: `compression` never released
// its zlib stream when the client disconnected early, leaking native
// handles per aborted response. Fixed in 1.8.2 with a `close` listener
// plus a closed-before-stream-exists path that drops the reference so
// later writes fall back to the raw response.

interface MockReq {
  method: string;
  headers: Record<string, string>;
}

interface MockRes extends EventEmitter {
  statusCode: number;
  headersSent: boolean;
  getHeader: (name: string) => string | undefined;
  setHeader: (name: string, value: string) => void;
  removeHeader: (name: string) => void;
  writeHead: (status: number) => void;
  write: (chunk: unknown, encoding?: string) => boolean;
  end: (chunk?: unknown, encoding?: string) => boolean;
  captured: Buffer[];
}

type Compression = (req: MockReq, res: MockRes, next: () => void) => void;

function createRes(): MockRes {
  const res = new EventEmitter() as MockRes;
  const headers = new Map<string, string>();
  res.statusCode = 200;
  res.headersSent = false;
  res.captured = [];
  res.getHeader = (name: string) => headers.get(name.toLowerCase());
  res.setHeader = (name: string, value: string) => {
    headers.set(name.toLowerCase(), value);
  };
  res.removeHeader = (name: string) => {
    headers.delete(name.toLowerCase());
  };
  res.writeHead = () => {
    res.headersSent = true;
  };
  res.write = (chunk: unknown) => {
    res.captured.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''))
    );
    return true;
  };
  res.end = (chunk?: unknown) => {
    if (chunk !== undefined) {
      res.captured.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      );
    } else {
      // The middleware's stream 'end' handler calls the raw end with no
      // chunk once the gzip stream has flushed: this is the deterministic
      // completion signal (no sleeps).
      res.emit('__flushed');
    }
    return true;
  };
  return res;
}

function flushed(res: MockRes): Promise<void> {
  return new Promise((resolve) => {
    res.once('__flushed', () => resolve());
  });
}

function loadCompression(): (options?: Record<string, unknown>) => Compression {
  const root = resolveRoot(
    'compression',
    process.env.COMPRESSION_ROOT,
    'COMPRESSION_ROOT'
  );
  return loadCjs(root);
}

const BODY = 'hello compression world\n'.repeat(200);

describe('compression integrity (CVE-2026-87776)', () => {
  it('falls back to raw writes when closed before streaming', () => {
    const compression = loadCompression();
    const req: MockReq = {
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    };
    const res = createRes();
    res.setHeader('Content-Type', 'text/plain');
    compression({ threshold: 0 })(req, res, () => {});
    res.emit('close');
    res.end(BODY);
    // Fixed: the abandoned stream is destroyed and dropped, so the body
    // passes through uncompressed with no Content-Encoding. Pre-fix the
    // stream survived close and emitted gzip bytes instead.
    expect(res.getHeader('Content-Encoding')).toBeUndefined();
    expect(Buffer.concat(res.captured).toString()).toBe(BODY);
  });

  it('still compresses when the response stays open', async () => {
    const compression = loadCompression();
    const req: MockReq = {
      method: 'GET',
      headers: { 'accept-encoding': 'gzip' },
    };
    const res = createRes();
    res.setHeader('Content-Type', 'text/plain');
    compression({ threshold: 0 })(req, res, () => {});
    const done = flushed(res);
    res.end(BODY);
    await done;
    expect(res.getHeader('Content-Encoding')).toBe('gzip');
    const raw = Buffer.concat(res.captured);
    expect(raw.toString()).not.toBe(BODY);
    expect(gunzipSync(raw).toString()).toBe(BODY);
  });
});
