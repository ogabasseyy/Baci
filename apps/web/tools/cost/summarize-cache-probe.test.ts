import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeCacheProbe } from './summarize-cache-probe';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('summarizeCacheProbe', () => {
  it('counts cache hits and calculates sampled TTFB percentiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cache-probe-'));
    roots.push(root);
    const path = join(root, 'probe.jsonl');
    await writeFile(
      path,
      '{"cacheStatus":"HIT","ttfbMs":12}\n{"cacheStatus":"MISS","ttfbMs":40}\n{"cacheStatus":"stale","ttfbMs":20}\n'
    );

    await expect(summarizeCacheProbe(path)).resolves.toMatchObject({
      cacheHitRatio: 2 / 3,
      cacheHitRows: 2,
      cacheStatusRows: 3,
      p50TtfbMs: 20,
      p95TtfbMs: 40,
      rows: 3,
    });
  });

  it('rejects cache rows that are not objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cache-probe-invalid-'));
    roots.push(root);
    const path = join(root, 'probe.jsonl');
    await writeFile(path, '[]\n');

    await expect(summarizeCacheProbe(path)).rejects.toThrow(
      'cache probe row is not an object'
    );
  });

  it('rejects present non-string cacheStatus samples', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cache-probe-status-'));
    roots.push(root);
    const path = join(root, 'probe.jsonl');
    await writeFile(
      path,
      '{"cacheStatus":"HIT","ttfbMs":12}\n{"cacheStatus":0,"ttfbMs":40}\n'
    );

    await expect(summarizeCacheProbe(path)).rejects.toThrow(
      'cache probe row has a non-string cacheStatus'
    );
  });
});
