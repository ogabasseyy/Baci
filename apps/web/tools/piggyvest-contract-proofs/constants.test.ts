import { describe, expect, it } from 'vitest';
import {
  AMOUNTS_KOBO,
  FEE_RESERVE_KOBO,
  FUNDING_FLOOR_KOBO,
  LIVE_MAX_POLLS,
  LIVE_POLL_INTERVAL_MS,
  MAX_MUTATION_KOBO,
  MAX_RUN_TOTAL_KOBO,
  MUTATION_CAPABLE_MODES,
  MUTATION_PATHS,
  PLANNED_OUTFLOWS_KOBO,
  RECORDING_ACCOUNT_EMAIL,
  RECORDING_ACCOUNT_NORMALISED_MARKERS,
  RUN_MODES,
  S8_OUTFLOWS_KOBO,
  SANDBOX_HOST,
  SANDBOX_ORIGIN,
} from './constants';
import { containsRecordingAccount } from './safety-guards';

describe('run modes', () => {
  it('has exactly the three modes, with dry-run first (the default)', () => {
    expect([...RUN_MODES]).toEqual([
      'dry-run',
      'live-readonly',
      'live-sandbox-mutations',
    ]);
  });

  it('allows state-changing requests only in dry-run (mock) and the explicit mutation mode', () => {
    expect([...MUTATION_CAPABLE_MODES]).toEqual([
      'dry-run',
      'live-sandbox-mutations',
    ]);
    expect(MUTATION_CAPABLE_MODES).not.toContain('live-readonly');
    for (const mode of MUTATION_CAPABLE_MODES)
      expect(RUN_MODES).toContain(mode);
  });
});

describe('sandbox origin', () => {
  it('is https on exactly the sandbox host, with nothing else in it', () => {
    expect(SANDBOX_HOST).toBe('staging.piggyvest.business');
    expect(SANDBOX_ORIGIN).toBe(`https://${SANDBOX_HOST}`);
    expect(new URL(SANDBOX_ORIGIN).origin).toBe(SANDBOX_ORIGIN);
  });
});

describe('recording account marker', () => {
  it('matches the recording account email through the normalised markers', () => {
    expect(containsRecordingAccount(RECORDING_ACCOUNT_EMAIL)).toBe(true);
    expect(RECORDING_ACCOUNT_NORMALISED_MARKERS.length).toBeGreaterThan(0);
    for (const marker of RECORDING_ACCOUNT_NORMALISED_MARKERS) {
      expect(marker).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('mutation paths', () => {
  it('are api/v1 paths only, without query strings', () => {
    expect(MUTATION_PATHS.length).toBeGreaterThan(0);
    for (const path of MUTATION_PATHS) {
      expect(path.startsWith('/api/v1/')).toBe(true);
      expect(path).not.toContain('?');
    }
    expect(new Set(MUTATION_PATHS).size).toBe(MUTATION_PATHS.length);
  });
});

describe('money limits', () => {
  it('keeps every planned amount within the per-call cap and the whole run within the run cap', () => {
    for (const amount of Object.values(AMOUNTS_KOBO)) {
      expect(Number.isInteger(amount)).toBe(true);
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(MAX_MUTATION_KOBO);
    }
    const everything = Object.values(AMOUNTS_KOBO).reduce((a, b) => a + b, 0);
    expect(everything).toBeLessThanOrEqual(MAX_RUN_TOTAL_KOBO);
    expect(MAX_MUTATION_KOBO).toBeLessThanOrEqual(MAX_RUN_TOTAL_KOBO);
  });

  it('sets the funding floor above every planned outflow plus a fee reserve', () => {
    // Proofs 2 (transfer + duplicate-reference re-send), 4 (transfer + bank
    // outflow) and 8 (main to goal) all draw on the main wallet.
    expect(PLANNED_OUTFLOWS_KOBO).toBe(
      AMOUNTS_KOBO.walletTransfer * 4 +
        AMOUNTS_KOBO.bankOutflow +
        S8_OUTFLOWS_KOBO
    );
    expect(FEE_RESERVE_KOBO).toBeGreaterThan(0);
    expect(FUNDING_FLOOR_KOBO).toBe(PLANNED_OUTFLOWS_KOBO + FEE_RESERVE_KOBO);
    // The old floor (3 transfers) left nothing for the bank fee.
    expect(FUNDING_FLOOR_KOBO).toBeGreaterThan(AMOUNTS_KOBO.walletTransfer * 3);
    expect(AMOUNTS_KOBO.fundMain).toBeGreaterThan(FUNDING_FLOOR_KOBO);
  });

  it('funds the house wallet with enough for the collection-to-main transfer', () => {
    expect(AMOUNTS_KOBO.fundHouse).toBeGreaterThan(AMOUNTS_KOBO.walletTransfer);
    // A main deposit that no other main-wallet credit shares, so its row is unambiguous.
    const otherMainCredits: number[] = [
      AMOUNTS_KOBO.fundMain,
      AMOUNTS_KOBO.walletTransfer,
      AMOUNTS_KOBO.fundGoal,
    ];
    expect(otherMainCredits).not.toContain(AMOUNTS_KOBO.depositMain);
  });

  it('budgets the S8 first pass: fund-goal, a wire-level second tap and the timed-out submit', () => {
    expect(S8_OUTFLOWS_KOBO).toBe(
      AMOUNTS_KOBO.s8FundGoal * 2 + AMOUNTS_KOBO.s8TimeoutTransfer
    );
    // The S8 deposit row must be told apart from every other main-wallet credit.
    const otherMainCredits: number[] = [
      AMOUNTS_KOBO.fundMain,
      AMOUNTS_KOBO.walletTransfer,
      AMOUNTS_KOBO.fundGoal,
      AMOUNTS_KOBO.depositMain,
      AMOUNTS_KOBO.s8FundGoal,
      AMOUNTS_KOBO.s8TimeoutTransfer,
    ];
    expect(otherMainCredits).not.toContain(AMOUNTS_KOBO.s8DepositMain);
    expect(AMOUNTS_KOBO.fundMain).toBeGreaterThan(FUNDING_FLOOR_KOBO);
  });
});

describe('live polling window', () => {
  it('gives each sandbox wait a budget of about two minutes', () => {
    // 2026-11-03 live runs: a ₦10,000 test funding never credited in one run,
    // and a goal credit landed an hour late in another, while the same calls
    // settled in under 20s on later runs. 30s (15 x 2s) misread slow
    // settlement as unsettled. A loop that sleeps after each read last
    // observes one interval before the budget ends, so require that point
    // to clear 100s.
    expect(LIVE_POLL_INTERVAL_MS * (LIVE_MAX_POLLS - 1)).toBeGreaterThanOrEqual(
      100_000
    );
    // Not so long that every stable-balance check (which always runs all
    // rounds) makes a run take hours.
    expect(LIVE_POLL_INTERVAL_MS * LIVE_MAX_POLLS).toBeLessThanOrEqual(300_000);
  });
});
