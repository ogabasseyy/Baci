import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from './mock-provider';
import { createFileJournal, createMemoryJournal } from './mutation-journal';
import { parseRunConfig, type RunConfig } from './run-mode';
import { currentAttempt, runHarness } from './runner';
import { allowlistFile, liveConfig, noSleep } from './runner.test-support';
import { HarnessRefusal } from './safety-guards';

afterEach(() => vi.unstubAllGlobals());

describe('refusals abort the run and write nothing', () => {
  it('refuses a recording-account entry in the allowlist before any network call', async () => {
    const mock = createMockProvider();
    const cfg = liveConfig('--live-readonly', {
      allowlistPath: allowlistFile(['baci-recording-20261013-x']),
    });
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: mock.fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'RECORDING_ACCOUNT' });
    expect(mock.calls).toHaveLength(0);
  });

  it('refuses a --qa-customer that is not on the allowlist', async () => {
    const cfg = liveConfig('--live-readonly', {
      qaCustomerId: 'qa-customer-9999',
    });
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: createMockProvider().fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'ALLOWLIST_INVALID' });
  });

  it('aborts without evidence when a response mentions the recording account', async () => {
    const write = vi.fn();
    const poisoned = (async () =>
      new Response(
        JSON.stringify({
          status: true,
          message: 'ok',
          data: [{ email: 'baci-recording-20261013@example.com' }],
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const cfg = liveConfig('--live-readonly');
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: poisoned,
        write,
        print: () => undefined,
      })
    ).rejects.toBeInstanceOf(HarnessRefusal);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a non-test key at run time even if config parsing was bypassed', async () => {
    const cfg = liveConfig('--live-readonly', { apiKey: 'live_key_Nope123' });
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: createMockProvider().fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'KEY_NOT_TEST' });
  });

  it('refuses a non-sandbox base URL at run time', async () => {
    const cfg = liveConfig('--live-readonly', {
      baseUrl: 'https://api.piggyvest.business',
    });
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: createMockProvider().fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'BASE_URL_NOT_SANDBOX' });
  });

  it('restores the global fetch after a refusal', async () => {
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);
    const cfg = liveConfig('--live-readonly', {
      qaCustomerId: 'qa-customer-9999',
    });
    await runHarness(cfg, {
      sleep: noSleep,
      fetchImpl: createMockProvider().fetch,
      print: () => undefined,
    }).catch(() => undefined);
    expect(globalThis.fetch).toBe(realFetch);
  });
});

describe('currentAttempt', () => {
  const entry = (attempt: number) => ({
    v: 1 as const,
    ts: 't',
    runId: 'r',
    phase: 'intent' as const,
    slot: 's',
    attempt,
    op: 'o',
    reference: `pvbproof-r-o-aaaa000${attempt}`,
    qaKey: 'qa-customer-1',
    amountKobo: null,
  });
  it('resumes the latest attempt, and --new-attempt opens the next one', () => {
    expect(currentAttempt(createMemoryJournal(), false)).toBe(1);
    expect(currentAttempt(createMemoryJournal(), true)).toBe(1);
    const journal = createMemoryJournal([entry(1), entry(2)]);
    expect(currentAttempt(journal, false)).toBe(2);
    expect(currentAttempt(journal, true)).toBe(3);
  });
});

describe('runHarness: unknown modes fail closed', () => {
  it('refuses a config whose mode is not one of the three run modes', async () => {
    const bogus = {
      ...parseRunConfig([], {}),
      mode: 'toString' as unknown as RunConfig['mode'],
    };
    await expect(
      runHarness(bogus, { print: () => undefined })
    ).rejects.toMatchObject({ code: 'USAGE' });
  });
});

describe('runHarness: the mutation journal', () => {
  it('releases the journal lock after a refusal, and refuses a second concurrent run before any network call', async () => {
    const mock = createMockProvider();
    const cfg = liveConfig('--live-sandbox-mutations');
    const held = createFileJournal(cfg.journalPath ?? '');
    await expect(
      runHarness(cfg, {
        sleep: noSleep,
        fetchImpl: mock.fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'JOURNAL_LOCKED' });
    expect(mock.calls).toHaveLength(0);
    held.release?.();

    const refused = { ...cfg, qaCustomerId: 'qa-customer-9999' };
    await expect(
      runHarness(refused, {
        sleep: noSleep,
        fetchImpl: mock.fetch,
        print: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'ALLOWLIST_INVALID' });
    createFileJournal(cfg.journalPath ?? '').release?.();
  });

  it('releases the lock after a normal run', async () => {
    const cfg = liveConfig('--live-sandbox-mutations');
    await runHarness(cfg, {
      sleep: noSleep,
      fetchImpl: createMockProvider().fetch,
      print: () => undefined,
    });
    expect(() =>
      createFileJournal(cfg.journalPath ?? '').release?.()
    ).not.toThrow();
  });
});
