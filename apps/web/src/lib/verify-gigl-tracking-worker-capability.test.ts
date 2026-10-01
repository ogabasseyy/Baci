import { describe, expect, it, vi } from 'vitest';
import {
  GiglWrapperSchemaMissingError,
  verifyGiglTrackingWorkerCapability,
} from './verify-gigl-tracking-worker-capability';

describe('verifyGiglTrackingWorkerCapability', () => {
  it('accepts the reviewed invalid-limit response without claiming work', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'bounded validation failure' },
    });

    await expect(
      verifyGiglTrackingWorkerCapability({ rpc } as never)
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('claim_due_gigl_tracking_monitors', {
      p_limit: 0,
      p_worker_id: 'gigl-capability-preflight',
    });
  });

  it('fails closed when credentials or wrapper authority are rejected', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied' },
      { code: 'PGRST301', message: 'invalid JWT' },
      { code: '42P01', message: 'relation "public.shipments" does not exist' },
      null,
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerCapability({ rpc } as never)
      ).resolves.toBe(false);
    }
  });

  it('throws schema-missing when the wrapper RPCs are not deployed yet', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'not found' },
      {
        code: '404',
        message:
          'Could not find the function public.claim_due_gigl_tracking_monitors in the schema cache',
      },
      {
        code: '42704',
        message: 'role "gigl_tracking_worker" does not exist',
      },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerCapability({ rpc } as never)
      ).rejects.toBeInstanceOf(GiglWrapperSchemaMissingError);
    }
  });
});
