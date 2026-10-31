import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { defaultEvidenceDir, main } from './cli';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';
import { SENSITIVE } from './sensitive-fixtures.test-support';

const noSleep = () => Promise.resolve();

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) },
  };
}
const env = { PVB_PROOF_API_KEY: MOCK_API_KEY };

describe('cli main', () => {
  it('defaults to a dry run that prints mock output and exits 0', async () => {
    const sink = io();
    expect(await main([], {}, sink.io)).toBe(0);
    expect(sink.out.join('\n')).toMatch(/MOCK DATA/);
    expect(sink.err).toEqual([]);
  });

  it('prints usage for --help without running anything', async () => {
    const sink = io();
    const fetchSpy = vi.fn();
    expect(
      await main(['--help'], {}, sink.io, {
        sleep: noSleep,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      })
    ).toBe(0);
    expect(sink.out.join('\n')).toMatch(/--live-readonly/);
    expect(sink.out.join('\n')).toMatch(/PVB_PROOF_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [['--bogus'], {}, 'USAGE'],
    [['--live-readonly'], env, 'ALLOWLIST_REQUIRED'],
    [['--dry-run', '--live-readonly'], env, 'MODE_CONFLICT'],
    [
      ['--live-readonly', '--allowlist', 'a.json'],
      { PVB_PROOF_API_KEY: 'live_key_TopSecret1' },
      'KEY_NOT_TEST',
    ],
    [
      ['--live-readonly', '--allowlist', 'a.json'],
      { ...env, PVB_PROOF_BASE_URL: 'https://api.piggyvest.business' },
      'BASE_URL_NOT_SANDBOX',
    ],
  ])('exits 2 with a refusal code for %j', async (argv, environment, code) => {
    const sink = io();
    expect(await main(argv, environment, sink.io)).toBe(2);
    expect(sink.err.join('\n')).toContain(code);
    expect(sink.err.join('\n')).not.toContain('TopSecret1');
    expect(sink.out).toEqual([]);
  });

  it('runs a read-only live pass over an injected transport and reports where evidence went', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pvb-cli-'));
    const allowlist = path.join(dir, 'allowlist.json');
    writeFileSync(
      allowlist,
      JSON.stringify({ qaCustomerIds: ['qa-customer-0001'] })
    );
    const mock = createMockProvider();
    const sink = io();
    const code = await main(
      [
        '--live-readonly',
        '--allowlist',
        allowlist,
        '--evidence-dir',
        path.join(dir, 'evidence'),
      ],
      env,
      sink.io,
      { sleep: noSleep, fetchImpl: mock.fetch }
    );
    expect(code).toBe(0);
    expect(mock.calls.every((call) => call.method === 'GET')).toBe(true);
    const text = sink.out.join('\n');
    expect(text).toMatch(/Evidence written/);
    expect(text).toMatch(/p1: /);
    expect(text).not.toContain(MOCK_API_KEY);
    expect(existsSync(path.join(dir, 'evidence'))).toBe(true);
  });

  it('never echoes unexpected error text (it could carry sensitive data)', async () => {
    const sink = io();
    const code = await main(['--dry-run'], {}, sink.io, {
      print: () => {
        throw new Error(`boom ${SENSITIVE.email}`);
      },
    });
    expect(code).toBe(1);
    expect(sink.err.join('\n')).toMatch(/unexpected error/i);
    expect(sink.err.join('\n')).not.toContain(SENSITIVE.email);
  });
});

describe('defaultEvidenceDir', () => {
  it('points at docs/piggyvest-contract-evidence in the repository', () => {
    const dir = defaultEvidenceDir();
    expect(dir.endsWith(path.join('docs', 'piggyvest-contract-evidence'))).toBe(
      true
    );
    expect(existsSync(path.dirname(dir))).toBe(true);
  });
});
