import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOAL_RECHECK_DELAY_MS } from './goal-interest-routing';
import { createMockProvider } from './mock-provider';
import { parseRunConfig } from './run-mode';
import { runHarness } from './runner';
import { env, liveConfig, noSleep, posts } from './runner.test-support';
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

  it('refuses an unknown proof id or a missing value', () => {
    expect(refusalCode(() => parseRunConfig(['--proof', 'p9'], env))).toBe(
      'USAGE'
    );
    expect(refusalCode(() => parseRunConfig(['--proof'], env))).toBe('USAGE');
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
