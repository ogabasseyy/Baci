import { describe, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { readOxygenNinRetryStatus } from './nin-retry-status';

const snapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 4,
  state: { kyc: { nin_status: 'NOT_DONE' } },
} as OxygenRuntimeSnapshot;

describe('NIN retry status', () => {
  it('binds the read to the exact workflow and version', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'safe_retry', error: null });
    expect(await readOxygenNinRetryStatus({ rpc }, snapshot)).toBe(
      'safe_retry'
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('oxygen_nin_attempt_status', {
      p_workflow_id: snapshot.workflowId,
      p_version: 4,
    });
  });
  it('fails closed on an RPC error and skips pending requests', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'error' } });
    expect(await readOxygenNinRetryStatus({ rpc }, snapshot)).toBe(
      'unavailable'
    );
    rpc.mockClear();
    expect(
      await readOxygenNinRetryStatus(
        { rpc },
        {
          ...snapshot,
          pending: {
            action: 'validate_nin',
            status: 'indeterminate',
            idempotencyKey: snapshot.workflowId,
          },
        }
      )
    ).toBe('blocked');
    expect(rpc).not.toHaveBeenCalled();
  });
});

it.each([
  'first_attempt',
  'blocked',
  'safe_retry',
] as const)('preserves the %s status', async (status) => {
  const rpc = vi.fn().mockResolvedValue({ data: status, error: null });
  expect(await readOxygenNinRetryStatus({ rpc }, snapshot)).toBe(status);
});

it('fails closed for an unexpected server value', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  expect(await readOxygenNinRetryStatus({ rpc }, snapshot)).toBe('unavailable');
});
