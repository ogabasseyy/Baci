import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GiglWrapperSchemaMissingError,
  verifyGiglTrackingWorkerCapability,
  verifyGiglTrackingWorkerScopeProbe,
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

describe('verifyGiglTrackingWorkerScopeProbe', () => {
  it('passes only on the hook denial message over a HEAD request', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'GIGL worker request is outside its capability scope',
      },
    });

    await expect(
      verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      {
        p_limit: 0,
        p_worker_id: 'gigl-capability-scope-probe',
      },
      { head: true }
    );
  });

  it('fails closed when the wrapper answers without the hook', async () => {
    // 22023 is the missed-reload shape: the wrapper itself validated the
    // input, which proves the request reached it without hook enforcement.
    for (const error of [
      { code: '22023', message: 'bounded validation failure' },
      { code: '42501', message: 'permission denied for function foo' },
      { code: 'PGRST301', message: 'invalid JWT' },
      null,
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
      ).resolves.toBe(false);
    }
  });

  it('throws schema-missing when the wrapper RPCs are not deployed yet', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'not found' },
    });

    await expect(
      verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
    ).rejects.toBeInstanceOf(GiglWrapperSchemaMissingError);
  });

  it('matches the denial message raised by the scope-hook migration', async () => {
    const restoreMigration = readFileSync(
      join(
        process.cwd(),
        '../../supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql'
      ),
      'utf8'
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'probe' },
    });

    // The probe only passes when the SQL message matches its expectation;
    // extract the migration's literal and require the probe to accept it.
    const raised = restoreMigration.match(
      /RAISE EXCEPTION '([^']+)'\s+USING ERRCODE = '42501'/
    );
    expect(raised?.[1]).toBe(
      'GIGL worker request is outside its capability scope'
    );
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: raised?.[1] },
    });
    await expect(
      verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
    ).resolves.toBe(true);
  });
});
