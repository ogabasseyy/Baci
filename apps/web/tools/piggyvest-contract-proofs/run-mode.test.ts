import { describe, expect, it } from 'vitest';
import { parseRunConfig } from './run-mode';
import { HarnessRefusal } from './safety-guards';

const KEY = 'test_key_AbC123xyz';
const LIVE_ENV = { PVB_PROOF_API_KEY: KEY };

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

describe('parseRunConfig: mode selection', () => {
  it('defaults to dry-run and never needs or reads a key', () => {
    const config = parseRunConfig([], {});
    expect(config.mode).toBe('dry-run');
    expect(config.apiKey).toBeNull();
  });

  it('dry-run ignores an ambient key entirely, even a live one', () => {
    const config = parseRunConfig(['--dry-run'], {
      PVB_PROOF_API_KEY: 'live_key_SECRET',
    });
    expect(config.apiKey).toBeNull();
  });

  it('refuses two modes at once', () => {
    expect(
      code(() => parseRunConfig(['--dry-run', '--live-readonly'], {}))
    ).toBe('MODE_CONFLICT');
    expect(
      code(() =>
        parseRunConfig(
          ['--live-readonly', '--live-sandbox-mutations'],
          LIVE_ENV
        )
      )
    ).toBe('MODE_CONFLICT');
  });

  it('refuses unknown flags and missing flag values', () => {
    expect(code(() => parseRunConfig(['--live'], {}))).toBe('USAGE');
    expect(code(() => parseRunConfig(['--allowlist'], {}))).toBe('USAGE');
    expect(code(() => parseRunConfig(['positional'], {}))).toBe('USAGE');
  });
});

describe('parseRunConfig: live modes', () => {
  it('live-readonly needs an allowlist and a test key', () => {
    expect(code(() => parseRunConfig(['--live-readonly'], LIVE_ENV))).toBe(
      'ALLOWLIST_REQUIRED'
    );
    expect(
      code(() =>
        parseRunConfig(['--live-readonly', '--allowlist', 'a.json'], {})
      )
    ).toBe('KEY_MISSING');
    const config = parseRunConfig(
      ['--live-readonly', '--allowlist', 'a.json'],
      LIVE_ENV
    );
    expect(config.mode).toBe('live-readonly');
    expect(config.apiKey).toBe(KEY);
    expect(config.allowlistPath).toBe('a.json');
  });

  it('mutations need the explicit flag AND an allowlist file', () => {
    expect(
      code(() => parseRunConfig(['--live-sandbox-mutations'], LIVE_ENV))
    ).toBe('ALLOWLIST_REQUIRED');
    const config = parseRunConfig(
      ['--live-sandbox-mutations', '--allowlist', 'a.json'],
      LIVE_ENV
    );
    expect(config.mode).toBe('live-sandbox-mutations');
  });

  it('refuses a live key in any live mode', () => {
    for (const flag of ['--live-readonly', '--live-sandbox-mutations']) {
      expect(
        code(() =>
          parseRunConfig([flag, '--allowlist', 'a.json'], {
            PVB_PROOF_API_KEY: 'live_key_AbC123xyz',
          })
        )
      ).toBe('KEY_NOT_TEST');
    }
  });

  it('prefers the dedicated env name over the hosted-funding fallback', () => {
    const config = parseRunConfig(['--live-readonly', '--allowlist', 'a'], {
      PVB_PROOF_API_KEY: KEY,
      PIGGYVEST_SAVINGS_FUNDING_API_SECRET: 'test_key_Other999',
    });
    expect(config.apiKey).toBe(KEY);
    const fallback = parseRunConfig(['--live-readonly', '--allowlist', 'a'], {
      PIGGYVEST_SAVINGS_FUNDING_API_SECRET: 'test_key_Other999',
    });
    expect(fallback.apiKey).toBe('test_key_Other999');
  });
});

describe('parseRunConfig: base URL and destinations', () => {
  it('refuses any base URL that is not exactly the sandbox host, in every mode', () => {
    for (const argv of [[], ['--live-readonly', '--allowlist', 'a']]) {
      expect(
        code(() =>
          parseRunConfig(argv, {
            ...LIVE_ENV,
            PVB_PROOF_BASE_URL: 'https://api.piggyvest.business',
          })
        )
      ).toBe('BASE_URL_NOT_SANDBOX');
    }
  });

  it('validates the optional bank destination and the recording account', () => {
    const base = ['--live-sandbox-mutations', '--allowlist', 'a'];
    expect(
      code(() =>
        parseRunConfig(base, {
          ...LIVE_ENV,
          PVB_PROOF_BANK_CODE: '058',
          PVB_PROOF_BANK_ACCOUNT: '12345',
        })
      )
    ).toBe('USAGE');
    const ok = parseRunConfig(base, {
      ...LIVE_ENV,
      PVB_PROOF_BANK_CODE: '058',
      PVB_PROOF_BANK_ACCOUNT: '0123456789',
    });
    expect(ok.bankCode).toBe('058');
    expect(ok.bankAccount).toBe('0123456789');
  });

  it('refuses a recording-account reference in any argument', () => {
    expect(
      code(() =>
        parseRunConfig(
          ['--live-readonly', '--allowlist', 'baci-recording-20261013.json'],
          LIVE_ENV
        )
      )
    ).toBe('RECORDING_ACCOUNT');
    expect(
      code(() =>
        parseRunConfig(
          [
            '--live-readonly',
            '--allowlist',
            'a',
            '--qa-customer',
            'baci-recording-x1',
          ],
          LIVE_ENV
        )
      )
    ).toBe('RECORDING_ACCOUNT');
  });

  it('carries the optional operator flags', () => {
    const config = parseRunConfig(
      [
        '--live-sandbox-mutations',
        '--allowlist',
        'a.json',
        '--journal',
        'j.jsonl',
        '--evidence-dir',
        'out',
        '--qa-customer',
        'qa-customer-1',
        '--new-attempt',
      ],
      LIVE_ENV
    );
    expect(config).toMatchObject({
      journalPath: 'j.jsonl',
      evidenceDir: 'out',
      qaCustomerId: 'qa-customer-1',
      newAttempt: true,
    });
  });
});

describe('parseRunConfig: inherited object keys are never modes', () => {
  it.each([
    'toString',
    'constructor',
    '__proto__',
    'hasOwnProperty',
    'valueOf',
  ])('refuses %s as an argument', (key) => {
    expect(
      code(() => parseRunConfig([key, '--allowlist', 'a.json'], LIVE_ENV))
    ).toBe('USAGE');
    expect(code(() => parseRunConfig([key], {}))).toBe('USAGE');
  });
});

describe('parseRunConfig: business payout wallet', () => {
  const base = ['--live-sandbox-mutations', '--allowlist', 'a'];
  const BUSINESS = 'PVB_PROOF_BUSINESS_WALLET_ID';
  it('reads the business sandbox wallet id from the environment, mutation mode only', () => {
    const id = '01M2TBUSINESSWALLET0000001';
    expect(
      parseRunConfig(base, { ...LIVE_ENV, [BUSINESS]: id }).businessWalletId
    ).toBe(id);
    expect(parseRunConfig(base, LIVE_ENV).businessWalletId).toBeNull();
    expect(
      parseRunConfig(['--live-readonly', '--allowlist', 'a'], {
        ...LIVE_ENV,
        [BUSINESS]: id,
      }).businessWalletId
    ).toBeNull();
    expect(parseRunConfig([], { [BUSINESS]: id }).businessWalletId).toBeNull();
  });

  it('refuses a malformed id and anything related to the recording account', () => {
    expect(
      code(() =>
        parseRunConfig(base, { ...LIVE_ENV, [BUSINESS]: 'has spaces in it' })
      )
    ).toBe('USAGE');
    expect(
      code(() => parseRunConfig(base, { ...LIVE_ENV, [BUSINESS]: '../../etc' }))
    ).toBe('USAGE');
    expect(
      code(() =>
        parseRunConfig(base, {
          ...LIVE_ENV,
          [BUSINESS]: 'baci-recording-20261013',
        })
      )
    ).toBe('RECORDING_ACCOUNT');
  });
});
