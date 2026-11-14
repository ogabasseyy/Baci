import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { writeEvidence } from './evidence-writer';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';
import { parseRunConfig } from './run-mode';
import { runHarness } from './runner';
import { liveConfig, noSleep, posts, statuses } from './runner.test-support';
import { SENSITIVE } from './sensitive-fixtures.test-support';

afterEach(() => vi.unstubAllGlobals());

describe('dry-run (default)', () => {
  it('uses only the mock, writes no evidence, labels the output as mock data and restores fetch', async () => {
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);
    const printed: string[] = [];
    const write = vi.fn();
    const summary = await runHarness(
      parseRunConfig([], { PVB_PROOF_API_KEY: 'live_key_NeverUsed' }),
      {
        print: (text) => printed.push(text),
        write,
      }
    );
    expect(realFetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(realFetch);
    expect(write).not.toHaveBeenCalled();
    expect(summary.exitCode).toBe(0);
    expect(statuses(summary)).toEqual({
      p1: 'observed',
      p2: 'observed',
      p3: 'observed',
      p4: 'observed',
      p5: 'observed',
      p6: 'observed',
      p7: 'observed',
      p8: 'observed',
      p9: 'observed',
      p10: 'observed',
    });
    const output = printed.join('\n');
    expect(output).toMatch(/MOCK DATA/);
    expect(output).not.toContain('live_key_NeverUsed');
    expect(output).not.toContain(MOCK_API_KEY);
  });

  it('prints evidence that contains none of the sensitive fixture types', async () => {
    const printed: string[] = [];
    await runHarness(parseRunConfig([], {}), {
      print: (text) => printed.push(text),
    });
    const output = printed.join('\n');
    for (const value of Object.values(SENSITIVE))
      expect(output).not.toContain(value);
    expect(output).toMatch(/\bW1\b/);
    expect(output).not.toMatch(/01M2T[0-9A-F]{21}/);
    expect(output).not.toMatch(/00000000-0000-4000-8000-\d{12}/);
  });
});

describe('live-readonly', () => {
  it('sends GET requests only and writes evidence', async () => {
    const mock = createMockProvider();
    const write = vi.fn((_input: Parameters<typeof writeEvidence>[0]) => ({
      markdownPath: 'a.md',
      jsonPath: 'a.json',
    }));
    const summary = await runHarness(liveConfig('--live-readonly'), {
      sleep: noSleep,
      fetchImpl: mock.fetch,
      write,
      print: () => undefined,
    });
    expect(posts(mock)).toEqual([]);
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ mode: 'live-readonly' });
    expect(summary.exitCode).toBe(0);
    expect(summary.evidence).toEqual({
      markdownPath: 'a.md',
      jsonPath: 'a.json',
    });
  });
});

describe('live-sandbox-mutations', () => {
  it('journals every mutation, sends each exactly once, and never resends on a re-run', async () => {
    const mock = createMockProvider();
    const cfg = liveConfig('--live-sandbox-mutations');
    const deps = {
      sleep: noSleep,
      fetchImpl: mock.fetch,
      print: () => undefined,
    };

    const first = await runHarness(cfg, deps);
    expect(first.exitCode).toBe(0);
    expect(posts(mock)).toEqual([
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/transfer/test/funding',
      // proof 1: the re-POST, then the same-BVN create under another identifier
      '/api/v1/customers',
      '/api/v1/customers',
      // proof 2: the transfer, then the deliberate duplicate-reference re-send
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/wallet',
      // proof 3: the goal deposit, then the house-wallet inflow
      '/api/v1/transfer/test/funding',
      '/api/v1/transfer/test/funding',
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/bank',
      // proof 7: a NEW payout-routing customer, then four goal sub-wallets
      '/api/v1/customers',
      ...Array(4).fill('/api/v1/wallet/sub-account'),
      // proof 8: collection to main, main to goal, goal to main
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/wallet',
      // proof 9: the main-wallet deposit
      '/api/v1/transfer/test/funding',
      // proof 10 (S8) runs on its own customer: create, goal wallet, funding
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/transfer/test/funding',
      // proof 10 (S8): a deposit, the goal funding, the same reference sent
      // again on the wire, then the transfer whose submit times out
      '/api/v1/transfer/test/funding',
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/wallet',
      '/api/v1/transfer/wallet',
    ]);
    const journalLines = readFileSync(cfg.journalPath ?? '', 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(journalLines.map((entry) => entry.phase)).toEqual(
      Array(27).fill(['intent', 'outcome']).flat()
    );
    // Every slot mints its own reference except the two deliberate repeats.
    expect(new Set(journalLines.map((entry) => entry.reference)).size).toBe(25);
    const referenceOf = (slot: string) =>
      journalLines.find((entry) => entry.slot === slot)?.reference;
    expect(referenceOf('p2/duplicate_reference')).toBe(referenceOf('p2/w2w'));
    expect(referenceOf('p10/double_tap_wire')).toBe(
      referenceOf('p10/fund_goal')
    );
    expect(JSON.stringify(journalLines)).not.toMatch(/01M2T[0-9A-F]{21}/);

    const before = mock.calls.length;
    const second = await runHarness(cfg, {
      ...deps,
      now: () => new Date('2026-10-31T10:00:00Z'),
    });
    expect(posts(mock).length).toBe(27);
    expect(mock.calls.length).toBeGreaterThan(before);
    expect(second.proofs.some((p) => p.status === 'inconclusive')).toBe(true);

    await runHarness({ ...cfg, newAttempt: true }, deps);
    expect(posts(mock).length).toBeGreaterThan(27);
  });

  it('uses unique references for every booked transfer', async () => {
    const mock = createMockProvider();
    await runHarness(liveConfig('--live-sandbox-mutations'), {
      sleep: noSleep,
      fetchImpl: mock.fetch,
      print: () => undefined,
    });
    const refs = mock.sandbox.ledger as unknown as {
      txns: { reference: string | null }[];
    };
    const transferRefs = refs.txns.map((t) => t.reference).filter(Boolean);
    // Proofs 2, 4 (wallet + bank), 8 (three legs) and 10 (goal funding and
    // the timed-out transfer); the mock refuses both duplicate-reference
    // re-sends, so they book nothing.
    expect(transferRefs).toHaveLength(8);
    expect(new Set(transferRefs).size).toBe(8);
  });

  it('keeps going when one proof throws unexpectedly, and reports the failure', async () => {
    const summary = await runHarness(parseRunConfig([], {}), {
      print: () => undefined,
      proofRunners: {
        p3: async () => {
          throw new TypeError(`boom ${SENSITIVE.email}`);
        },
      },
    });
    expect(statuses(summary).p3).toBe('failed');
    expect(statuses(summary).p4).toBe('observed');
    expect(summary.exitCode).toBe(1);
  });
});
