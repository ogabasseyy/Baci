import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOAL_RECHECK_DELAY_MS } from './goal-interest-routing';
import { createMockProvider } from './mock-provider';
import { isProof7KeyOf } from './qa-keys';
import { parseRunConfig, type RunConfig } from './run-mode';
import { runHarness } from './runner';
import { env, liveConfig, noSleep, posts, QA } from './runner.test-support';
import { HarnessRefusal } from './safety-guards';

afterEach(() => vi.unstubAllGlobals());

function refusalCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

describe('--proof: run one proof only', () => {
  it('parses a known proof id and defaults to every proof', () => {
    expect(parseRunConfig(['--proof', 'p7'], env).proof).toBe('p7');
    expect(parseRunConfig([], env).proof).toBeNull();
  });

  it('accepts p10 (S8) alone, but never with --new-attempt', () => {
    expect(parseRunConfig(['--proof', 'p10'], env).proof).toBe('p10');
    expect(
      refusalCode(() =>
        parseRunConfig(['--proof', 'p10', '--new-attempt'], env)
      )
    ).toBe('USAGE');
  });

  it('refuses an unknown proof id or a missing value', () => {
    expect(refusalCode(() => parseRunConfig(['--proof', 'p9'], env))).toBe(
      'USAGE'
    );
    expect(refusalCode(() => parseRunConfig(['--proof'], env))).toBe('USAGE');
  });

  it('refuses p6 alone: it measures the transfer and deposit that proofs 2 and 3 make', async () => {
    expect(refusalCode(() => parseRunConfig(['--proof', 'p6'], env))).toBe(
      'USAGE'
    );
    const mock = createMockProvider();
    await expect(
      runHarness(liveConfig('--live-sandbox-mutations', { proof: 'p6' }), {
        fetchImpl: mock.fetch,
        sleep: noSleep,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(mock.calls).toEqual([]);
  });

  it('refuses --new-attempt with a proof that runs the shared scenario, before any request', async () => {
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      expect(
        refusalCode(() => parseRunConfig(['--proof', id, '--new-attempt'], env))
      ).toBe('USAGE');
      expect(parseRunConfig(['--proof', id], env).proof).toBe(id);
    }
    expect(
      parseRunConfig(['--proof', 'p7', '--new-attempt'], env)
    ).toMatchObject({ proof: 'p7', newAttempt: true });
    const mock = createMockProvider();
    await expect(
      runHarness(
        liveConfig('--live-sandbox-mutations', {
          proof: 'p3',
          newAttempt: true,
        }),
        { fetchImpl: mock.fetch, sleep: noSleep, print: () => undefined }
      )
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(mock.calls).toEqual([]);
  });

  it('dry-run: runs only proof 7, touches no network and prints the goal readings', async () => {
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);
    const printed: string[] = [];
    const summary = await runHarness(parseRunConfig(['--proof', 'p7'], {}), {
      print: (text) => printed.push(text),
    });
    expect(realFetch).not.toHaveBeenCalled();
    expect(summary.proofs).toEqual([{ proof: 'p7', status: 'observed' }]);
    const output = printed.join('\n');
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(output).toContain(`goal_${id}_payout_at_0m`);
      expect(output).toContain(`goal_${id}_payout_at_5m`);
    }
    expect(output).not.toMatch(/baci-save-|bacisave/);
  });

  it('armed: proof 7 alone creates only its customer and four goals, waits five minutes once, and writes clean evidence', async () => {
    const mock = createMockProvider();
    const sleep = vi.fn((_ms: number) => noSleep());
    const config = liveConfig('--live-sandbox-mutations', { proof: 'p7' });
    const summary = await runHarness(config, {
      fetchImpl: mock.fetch,
      sleep,
      print: () => undefined,
    });
    expect(posts(mock)).toEqual([
      '/api/v1/customers',
      ...Array(4).fill('/api/v1/wallet/sub-account'),
    ]);
    expect(summary.spentKobo).toBe(0);
    expect(summary.proofs.map((p) => p.proof)).toEqual(['p7']);
    expect(sleep).toHaveBeenCalledWith(GOAL_RECHECK_DELAY_MS);
    expect(
      sleep.mock.calls.filter(([ms]) => ms === GOAL_RECHECK_DELAY_MS)
    ).toHaveLength(1);
    expect(summary.evidence?.markdownPath).toMatch(/\.md$/);

    // A plain re-run never resends a slot.
    const again = await runHarness(config, {
      fetchImpl: mock.fetch,
      sleep: noSleep,
      print: () => undefined,
    });
    expect(posts(mock)).toHaveLength(5);
    expect(again.proofs).toEqual([{ proof: 'p7', status: 'inconclusive' }]);
  });
});

describe('a proof-7 attempt never makes the shared scenario look fresh', () => {
  function harness() {
    const mock = createMockProvider();
    const base = liveConfig('--live-sandbox-mutations');
    const run = (extra: Partial<RunConfig> = {}) =>
      runHarness(
        { ...base, ...extra },
        { fetchImpl: mock.fetch, sleep: noSleep, print: () => undefined }
      );
    const journal = () =>
      readFileSync(base.journalPath ?? '', 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { qaKey: string; attempt: number });
    return { mock, run, journal };
  }
  const P7_ONLY = [
    '/api/v1/customers',
    ...Array(4).fill('/api/v1/wallet/sub-account'),
  ];

  it('a plain run after `--proof p7 --new-attempt` resumes the scenario and sends nothing', async () => {
    const { mock, run } = harness();
    await run();
    const afterFull = posts(mock).length;
    await run({ proof: 'p7', newAttempt: true });
    expect(posts(mock).slice(afterFull)).toEqual(P7_ONLY);
    const before = posts(mock).length;

    const plain = await run();
    expect(posts(mock)).toHaveLength(before);
    expect(plain.spentKobo).toBe(0);
    await run({ proof: 'p1' });
    await run({ proof: 'p4' });
    expect(posts(mock)).toHaveLength(before);
    // Proof 7 alone still resumes its own newest attempt.
    const p7 = await run({ proof: 'p7' });
    expect(posts(mock)).toHaveLength(before);
    expect(p7.proofs).toEqual([{ proof: 'p7', status: 'inconclusive' }]);
  });

  it('a full --new-attempt run opens an attempt above the proof-7 one', async () => {
    const { mock, run, journal } = harness();
    await run();
    await run({ proof: 'p7', newAttempt: true });
    const before = posts(mock).length;
    await run({ newAttempt: true });
    expect(posts(mock).length).toBeGreaterThan(before);
    const entries = journal();
    const attempts = (match: (key: string) => boolean) =>
      [
        ...new Set(entries.filter((e) => match(e.qaKey)).map((e) => e.attempt)),
      ].sort();
    expect(attempts((key) => key === QA)).toEqual([1, 3]);
    expect(attempts((key) => isProof7KeyOf(QA, key))).toEqual([1, 2, 3]);
  });
});
