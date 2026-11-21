import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bankRefreshLockKey } from './supported-bank-refresh-lock';

describe('bank refresh lock key', () => {
  it('keeps the key format the scheduled recovery job already uses', () => {
    const digest = createHash('sha256').update('partner').digest('hex');

    expect(bankRefreshLockKey('production', 'partner')).toBe(
      `oxygen:supported-banks-recovery:production:${digest}`
    );
  });

  it('separates environments and partner references', () => {
    const keys = new Set([
      bankRefreshLockKey('production', 'partner'),
      bankRefreshLockKey('staging', 'partner'),
      bankRefreshLockKey('production', 'other-partner'),
    ]);

    expect(keys.size).toBe(3);
  });

  it('never contains the raw partner reference', () => {
    expect(bankRefreshLockKey('production', 'partner-ref-123')).not.toContain(
      'partner-ref-123'
    );
  });
});
