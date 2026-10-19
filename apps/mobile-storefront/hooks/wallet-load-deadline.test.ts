import { describe, expect, it, jest } from '@jest/globals';
import {
  runWithWalletLoadDeadline,
  WALLET_LOAD_TIMEOUT_MS,
} from './wallet-load-deadline';

describe('runWithWalletLoadDeadline', () => {
  it('rejects a stalled load at the deadline instead of hanging forever', async () => {
    // Codex R93 P2: a stalled Supabase request left useWallet
    // loading indefinitely and the mandatory purchase gate rejects
    // every attempt while loading. The deadline converts the stall
    // into a retryable error the gate surfaces with Try Again.
    expect(WALLET_LOAD_TIMEOUT_MS).toBe(30_000);
    jest.useFakeTimers();
    try {
      const pending = runWithWalletLoadDeadline(
        () => new Promise<never>(() => {})
      );
      const assertion = expect(pending).rejects.toThrow(
        'Wallet load timed out'
      );
      await jest.advanceTimersByTimeAsync(WALLET_LOAD_TIMEOUT_MS);
      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors TanStack cancellation promptly', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = runWithWalletLoadDeadline(
        () => new Promise<never>(() => {}),
        controller.signal
      );
      const assertion = expect(pending).rejects.toThrow();
      controller.abort();
      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes healthy loads through and propagates loader errors', async () => {
    await expect(runWithWalletLoadDeadline(async () => 'ok')).resolves.toBe(
      'ok'
    );
    await expect(
      runWithWalletLoadDeadline(async () => {
        throw new Error('loader blew up');
      })
    ).rejects.toThrow('loader blew up');
  });
});
