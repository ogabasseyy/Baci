import { describe, expect, it } from 'vitest';
import {
  adapters,
  event,
  key,
  lease,
  secondLease,
} from './replay-test-fixtures';

describe('replay-test-fixtures', () => {
  it('builds a deterministic sealed lease for the canonical event', () => {
    const first = lease();
    expect(first.eventId).toBe(event.eventId);
    expect(first.sealed.keyVersion).toBe('staging-v1');
    expect(lease().sealed.payloadSha256).toBe(first.sealed.payloadSha256);
    expect(key).toHaveLength(32);
  });

  it('issues a distinct second lease', () => {
    const other = secondLease();
    expect(other.receiptId).not.toBe(lease().receiptId);
    expect(other.eventId).toBe('evt-worker-002');
  });

  it('provides mock adapters with overrides', async () => {
    const configured = adapters();
    expect(configured.claimBatch).toBeTypeOf('function');
    await expect(configured.claimBatch()).resolves.toHaveLength(1);
    const overridden = adapters({ dispatch: (async () => 'skipped') as never });
    await expect(overridden.dispatch()).resolves.toBe('skipped');
  });
});
