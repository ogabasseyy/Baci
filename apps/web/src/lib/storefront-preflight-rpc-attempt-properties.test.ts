import { describe, expect, it } from 'vitest';
import { getRpcAttemptProperties } from './storefront-preflight-rpc-attempt-properties';

describe('getRpcAttemptProperties', () => {
  it('serializes a full attempt context to snake_case properties', () => {
    expect(
      getRpcAttemptProperties({
        attemptId: 'a1',
        deadlineMs: 4_000,
        elapsedMs: 12,
        outcome: 'client-timeout',
        rpcName: 'fn',
      })
    ).toEqual({
      attempt_id: 'a1',
      deadline_ms: 4_000,
      elapsed_ms: 12,
      outcome: 'client-timeout',
      rpc_name: 'fn',
    });
  });

  it('omits absent fields instead of emitting undefined', () => {
    expect(getRpcAttemptProperties({})).toEqual({});
    expect(getRpcAttemptProperties({ rpcName: 'fn' })).toEqual({
      rpc_name: 'fn',
    });
  });
});
