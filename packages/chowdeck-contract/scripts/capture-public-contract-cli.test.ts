import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCaptureCli } from './capture-public-contract.mjs';

describe('public capture CLI', () => {
  it('supports the Task 2 --sources and --out directory contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-cli-'));
    const outputPath = join(directory, 'public-contract.json');

    await runCaptureCli({
      argv: [
        '--',
        '--sources',
        'config/public-document-sources.json',
        '--out',
        directory,
      ],
      now: () => new Date('2026-09-05T12:00:00.000Z'),
      fetchImpl: async () =>
        new Response('# Synthetic public documentation', {
          headers: { 'content-type': 'text/markdown' },
        }),
    });

    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({
      contractVersion: 1,
    });
  });

  it('uses only the fixed manifest and writes a validated receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-cli-'));
    const outputPath = join(directory, 'receipt.json');
    const calls: string[] = [];

    await runCaptureCli({
      argv: ['--output', outputPath],
      now: () => new Date('2026-09-05T12:00:00.000Z'),
      fetchImpl: async (input) => {
        calls.push(input);
        return new Response('# Synthetic public documentation', {
          headers: { 'content-type': 'text/markdown' },
        });
      },
    });

    const receipt = JSON.parse(await readFile(outputPath, 'utf8')) as {
      capturedAt: string;
      claims: unknown[];
    };
    expect(calls).toHaveLength(9);
    expect(calls.every((url) => url.endsWith('.md'))).toBe(true);
    expect(receipt.capturedAt).toBe('2026-09-05T12:00:00.000Z');
    expect(receipt.claims).toHaveLength(9);
  });

  it('normalizes capture time to a canonical whole second', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-cli-'));
    const outputPath = join(directory, 'receipt.json');

    await runCaptureCli({
      argv: ['--output', outputPath],
      now: () => new Date('2026-09-08T12:34:56.987Z'),
      fetchImpl: async () =>
        new Response('# Synthetic public documentation', {
          headers: { 'content-type': 'text/markdown' },
        }),
    });

    const receipt = JSON.parse(await readFile(outputPath, 'utf8')) as {
      capturedAt: string;
    };
    expect(receipt.capturedAt).toBe('2026-09-08T12:34:56.000Z');
  });

  it('rejects caller-selected source arguments before fetching', async () => {
    let calls = 0;

    await expect(
      runCaptureCli({
        argv: ['--source', 'https://example.test/contract'],
        now: () => new Date('2026-09-05T12:00:00.000Z'),
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
      }),
    ).rejects.toThrow('Invalid capture arguments');
    expect(calls).toBe(0);
  });

  it('rejects an alternate --sources manifest before fetching', async () => {
    let calls = 0;

    await expect(
      runCaptureCli({
        argv: ['--sources', 'config/other.json', '--out', '/tmp/evidence'],
        now: () => new Date('2026-09-05T12:00:00.000Z'),
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
      })
    ).rejects.toThrow('Invalid capture arguments');
    expect(calls).toBe(0);
  });

  it('rejects extra package separators and trailing arguments', async () => {
    const fetchImpl = async () => new Response();

    await expect(
      runCaptureCli({
        argv: [
          '--',
          '--',
          '--sources',
          'config/public-document-sources.json',
          '--out',
          '/tmp/evidence',
        ],
        now: () => new Date('2026-09-05T12:00:00.000Z'),
        fetchImpl,
      })
    ).rejects.toThrow('Invalid capture arguments');
    await expect(
      runCaptureCli({
        argv: [
          '--',
          '--sources',
          'config/public-document-sources.json',
          '--out',
          '/tmp/evidence',
          'extra',
        ],
        now: () => new Date('2026-09-05T12:00:00.000Z'),
        fetchImpl,
      })
    ).rejects.toThrow('Invalid capture arguments');
  });
});
