import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mock-provider';
import { createMemoryJournal } from './mutation-journal';
import { currentAttempt, runHarness } from './runner';
import { liveConfig, noSleep } from './runner.test-support';

afterEach(() => vi.unstubAllGlobals());

describe('currentAttempt: scoped to the selected QA customer', () => {
  const entry = (attempt: number, qaKey = 'qa-customer-1') => ({
    v: 1 as const,
    ts: 't',
    runId: 'r',
    phase: 'intent' as const,
    slot: 's',
    attempt,
    op: 'o',
    reference: `pvbproof-r-o-${qaKey.slice(-4)}000${attempt}`,
    qaKey,
    amountKobo: null,
  });
  it('resumes the latest attempt, and --new-attempt opens the next one', () => {
    expect(currentAttempt(createMemoryJournal(), 'qa-customer-1', false)).toBe(
      1
    );
    expect(currentAttempt(createMemoryJournal(), 'qa-customer-1', true)).toBe(
      1
    );
    const journal = createMemoryJournal([entry(1), entry(2)]);
    expect(currentAttempt(journal, 'qa-customer-1', false)).toBe(2);
    expect(currentAttempt(journal, 'qa-customer-1', true)).toBe(3);
  });

  it("ignores other QA customers' attempts", () => {
    const journal = createMemoryJournal([
      entry(1, 'qa-customer-1'),
      entry(1, 'qa-customer-2'),
      entry(2, 'qa-customer-2'),
    ]);
    expect(currentAttempt(journal, 'qa-customer-1', false)).toBe(1);
    expect(currentAttempt(journal, 'qa-customer-1', true)).toBe(2);
    expect(currentAttempt(journal, 'qa-customer-2', false)).toBe(2);
    expect(currentAttempt(journal, 'qa-customer-3', false)).toBe(1);
  });

  it("counts a customer's own derived proof-7 keys, and only those", () => {
    const derived = 'qa-customer-1-p7a3';
    const journal = createMemoryJournal([
      entry(1, 'qa-customer-1'),
      entry(3, derived),
      entry(9, 'qa-customer-1-other'),
    ]);
    expect(currentAttempt(journal, 'qa-customer-1', false)).toBe(3);
  });
});

describe('runHarness: a new attempt for one QA customer never re-opens another', () => {
  it('keeps customer A on attempt 1 and resends nothing after customer B opened attempt 2', async () => {
    const mock = createMockProvider();
    const dir = mkdtempSync(path.join(tmpdir(), 'pvb-attempts-'));
    const allowlist = path.join(dir, 'allowlist.json');
    writeFileSync(
      allowlist,
      JSON.stringify({ qaCustomerIds: ['qa-customer-A1', 'qa-customer-B1'] })
    );
    const base = liveConfig('--live-sandbox-mutations', {
      allowlistPath: allowlist,
      journalPath: path.join(dir, 'journal.jsonl'),
      evidenceDir: path.join(dir, 'evidence'),
    });
    const deps = {
      sleep: noSleep,
      fetchImpl: mock.fetch,
      print: () => undefined,
    };
    const posts = () => mock.calls.filter((c) => c.method === 'POST').length;

    await runHarness({ ...base, qaCustomerId: 'qa-customer-A1' }, deps);
    await runHarness({ ...base, qaCustomerId: 'qa-customer-B1' }, deps);
    await runHarness(
      { ...base, qaCustomerId: 'qa-customer-B1', newAttempt: true },
      deps
    );
    const before = posts();

    const rerunA = await runHarness(
      { ...base, qaCustomerId: 'qa-customer-A1' },
      deps
    );
    expect(posts()).toBe(before);
    expect(rerunA.proofs.some((p) => p.status === 'inconclusive')).toBe(true);

    const entries = readFileSync(base.journalPath ?? '', 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const attemptsOf = (key: string) =>
      new Set(
        entries.filter((e) => e.qaKey.startsWith(key)).map((e) => e.attempt)
      );
    expect([...attemptsOf('qa-customer-A1')]).toEqual([1]);
    expect([...attemptsOf('qa-customer-B1')].sort()).toEqual([1, 2]);
  });
});
