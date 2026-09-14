import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { validateArtifacts } from './sitespeed-artifacts.mjs';

it('scans HARs after the first valid sample and rejects a later failed critical resource', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitespeed-har-scan-'));
  try {
    await mkdir(join(root, 'first'), { recursive: true });
    await mkdir(join(root, 'second'), { recursive: true });
    const valid = {
      log: {
        browser: { name: 'Chrome', version: '151' },
        pages: [
          { _visualMetrics: { FirstVisualChange: 1, LastVisualChange: 2 } },
        ],
        entries: [],
      },
    };
    const failed = {
      log: {
        pages: [
          { _visualMetrics: { FirstVisualChange: 1, LastVisualChange: 2 } },
        ],
        entries: [
          {
            _resourceType: 'stylesheet',
            request: { url: 'http://local/style.css' },
            response: { status: 500, content: { mimeType: 'text/css' } },
          },
        ],
      },
    };
    await writeFile(
      join(root, 'first', 'browsertime.har'),
      JSON.stringify(valid)
    );
    await writeFile(
      join(root, 'second', 'browsertime.har'),
      JSON.stringify(failed)
    );
    await writeFile(join(root, 'run.mp4'), 'video');
    await writeFile(join(root, 'console-1.json.gz'), gzipSync('[]'));
    expect(() => validateArtifacts(root)).toThrow(
      'failed critical resource in HAR'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a zero-byte video even when HAR metrics are valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitespeed-empty-video-'));
  try {
    const har = {
      log: {
        pages: [
          { _visualMetrics: { FirstVisualChange: 1, LastVisualChange: 2 } },
        ],
        entries: [],
      },
    };
    await writeFile(join(root, 'run.har'), JSON.stringify(har));
    await writeFile(join(root, 'run.mp4'), '');
    await writeFile(join(root, 'console-1.json.gz'), gzipSync('[]'));
    expect(() => validateArtifacts(root)).toThrow(/video/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  ['missing', null, /missing console evidence/],
  ['malformed', Buffer.from('not-gzip'), /malformed console evidence/],
  ['object', gzipSync('{}'), /malformed console evidence/],
  ['invalid-record', gzipSync('[null]'), /malformed console evidence/],
  [
    'error-level',
    gzipSync('[{"level":"ERROR"}]'),
    /error-level console record/,
  ],
  [
    'error',
    gzipSync(JSON.stringify([{ level: 'SEVERE', message: 'failure' }])),
    /error-level console record/,
  ],
])('rejects %s console evidence', async (_label, payload, expected) => {
  const root = await mkdtemp(join(tmpdir(), 'sitespeed-console-'));
  try {
    const har = {
      log: {
        pages: [
          { _visualMetrics: { FirstVisualChange: 1, LastVisualChange: 2 } },
        ],
        entries: [],
      },
    };
    await writeFile(join(root, 'run.har'), JSON.stringify(har));
    await writeFile(join(root, 'run.mp4'), 'video');
    if (payload) await writeFile(join(root, 'console-1.json.gz'), payload);
    expect(() => validateArtifacts(root)).toThrow(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
